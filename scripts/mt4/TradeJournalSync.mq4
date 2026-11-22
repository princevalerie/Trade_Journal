//+------------------------------------------------------------------+
//|                                           TradeJournalSync.mq4   |
//|                 Trade Journal Multi-Account Realtime & History   |
//|                Institutional Edition for MetaTrader 4            |
//+------------------------------------------------------------------+
#property copyright "Trade Journal & PrinceAlgo"
#property link      "https://journal-valbury-prince.vercel.app"
#property version   "3.00"
#property description "Complete Real-time & History Sync with MAE/MFE, Account Mode/Leverage, and Auto Chart Screenshots"
#property strict

//--- Enumerations
enum ENUM_SYNC_SCOPE
{
   SYNC_ALL_HISTORY = 0,   // Sync All History (From Account Beginning)
   SYNC_PAST_DAYS   = 1,   // Sync Past N Days
   SYNC_FROM_DATE   = 2    // Sync From Specific Date
};

//--- Input Parameters
//--- 1. Journal Backend Connection ---
input string            InpApiUrl          = "https://journal-valbury-prince.vercel.app/api/webhooks/mt4"; // Webhook URL (Trade Journal proxy / server)
input string            InpApiKey          = "Valbury05@";                                             // API Secret Key (MT_WEBHOOK_SECRET)
input string            InpAccountName     = "";                                                       // Custom Account Name (optional)

//--- 2. History Synchronization ---
input ENUM_SYNC_SCOPE   InpSyncScope       = SYNC_ALL_HISTORY;                         // History Sync Scope
input int               InpSyncDays        = 365;                                      // Past Days (if Past N Days selected)
input datetime          InpSyncStartDate   = D'2020.01.01 00:00:00';                   // Start Date (if Specific Date selected)
input int               InpBatchSize       = 100;                                      // Batch Size (orders per HTTP request)

//--- 3. Monitoring & Heartbeat ---
input int               InpHeartbeatSec    = 5;                                        // Live Heartbeat & Positions (seconds)
input bool              InpShowDashboard   = true;                                     // Show On-Chart GUI Dashboard

//--- 4. Visuals & Chart Screenshots ---
input bool              InpAutoScreenshot  = true;                                     // Auto Capture Chart Screenshot on Trade
input int               InpScreenshotWidth = 800;                                      // Screenshot Width (pixels)
input int               InpScreenshotHeight= 450;                                      // Screenshot Height (pixels)

//--- GUI Object Prefixes
#define GUI_PREFIX "TJS4_"

//--- Forward Declarations
void ForceFullResync();

//--- Global Variables
datetime g_last_synced_time   = 0;
int      g_total_orders_synced= 0;
string   g_sync_status        = "Initializing...";
color    g_status_color       = clrYellow;

// Known open tickets tracker for MT4 realtime detection
int      g_open_tickets[];

//+------------------------------------------------------------------+
//| Calculate Broker GMT Offset in Seconds (Rounded to Half-Hour)    |
//+------------------------------------------------------------------+
int GetBrokerGmtOffset()
{
   datetime serverNow = TimeCurrent();
   datetime gmtNow    = TimeGMT();
   double rawDiff     = (double)(serverNow - gmtNow);
   // Round to nearest 30 minutes (1800s) to prevent +/- 1s tick latency drift
   return (int)(MathRound(rawDiff / 1800.0) * 1800);
}

//+------------------------------------------------------------------+
//| Format datetime to true UTC ISO 8601 string (YYYY-MM-DDTHH:MM:SSZ)|
//+------------------------------------------------------------------+
string TimeToIso8601Utc(datetime serverTime)
{
   if(serverTime <= 0) return "";
   datetime utcTime = serverTime - GetBrokerGmtOffset();
   MqlDateTime dt;
   TimeToStruct(utcTime, dt);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d.000Z", 
      dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec);
}

//+------------------------------------------------------------------+
//| Escape JSON special characters                                   |
//+------------------------------------------------------------------+
string EscapeJson(string str)
{
   StringReplace(str, "\\", "\\\\");
   StringReplace(str, "\"", "\\\"");
   StringReplace(str, "\r", "");
   StringReplace(str, "\n", " ");
   return str;
}

//+------------------------------------------------------------------+
//| Find Chart ID matching symbol or fallback to current chart       |
//+------------------------------------------------------------------+
long GetChartIdForSymbol(string sym)
{
   if(StringLen(sym) == 0) return 0;
   long chartId = ChartFirst();
   while(chartId >= 0)
   {
      if(ChartSymbol(chartId) == sym)
         return chartId;
      chartId = ChartNext(chartId);
   }
   return 0; // fallback to current chart
}

//+------------------------------------------------------------------+
//| Capture Chart Screenshot and Encode to Base64                    |
//+------------------------------------------------------------------+
string CaptureChartScreenshotBase64(int ticket, string sym = "")
{
   if(!InpAutoScreenshot) return "";
   
   long targetChartId = 0;
   bool openedTemp = false;
   if(StringLen(sym) > 0)
   {
      targetChartId = GetChartIdForSymbol(sym);
      if(targetChartId == 0 && ChartSymbol(0) != sym)
      {
         targetChartId = ChartOpen(sym, PERIOD_M15);
         if(targetChartId > 0)
            openedTemp = true;
         else
            targetChartId = 0;
      }
   }

   string filename = StringFormat("TradeJournal_MT4_%d.png", ticket);
   ResetLastError();
   
   if(!ChartScreenShot(targetChartId, filename, InpScreenshotWidth, InpScreenshotHeight, ALIGN_RIGHT))
   {
      PrintFormat("⚠️ [TradeJournalSync-MT4] ChartScreenShot failed (%d) for symbol: %s", GetLastError(), sym);
      if(openedTemp && targetChartId > 0) ChartClose(targetChartId);
      return "";
   }

   if(openedTemp && targetChartId > 0)
   {
      ChartClose(targetChartId);
   }

   int fileHandle = FileOpen(filename, FILE_READ|FILE_BIN);
   if(fileHandle == INVALID_HANDLE) return "";

   ulong fileSize = FileSize(fileHandle);
   if(fileSize == 0 || fileSize > 4 * 1024 * 1024)
   {
      FileClose(fileHandle);
      FileDelete(filename);
      return "";
   }

   uchar fileBytes[];
   ArrayResize(fileBytes, (int)fileSize);
   FileReadArray(fileHandle, fileBytes, 0, (int)fileSize);
   FileClose(fileHandle);
   FileDelete(filename); // cleanup local disk

   uchar key[];
   uchar base64Bytes[];
   if(CryptEncode(CRYPT_BASE64, fileBytes, key, base64Bytes) > 0)
   {
      return CharArrayToString(base64Bytes, 0, WHOLE_ARRAY, CP_ACP);
   }
   return "";
}

//+------------------------------------------------------------------+
//| Calculate MAE & MFE from M1 historical bars for MT4              |
//+------------------------------------------------------------------+
void GetOrderExcursions(
   string sym,
   int orderType,
   datetime openTime,
   datetime closeTime,
   double entryPrice,
   double volume,
   double &outMae,
   double &outMfe,
   int &outBars
)
{
   outMae = 0.0;
   outMfe = 0.0;
   outBars = 0;

   if(openTime <= 0 || closeTime <= openTime || entryPrice <= 0.0) return;

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(sym, PERIOD_M1, openTime, closeTime, rates);
   if(copied <= 0) return;

   outBars = copied;
   double lowestLow = rates[0].low;
   double highestHigh = rates[0].high;

   for(int r = 1; r < copied; r++)
   {
      if(rates[r].low < lowestLow) lowestLow = rates[r].low;
      if(rates[r].high > highestHigh) highestHigh = rates[r].high;
   }

   double tickValue = MarketInfo(sym, MODE_TICKVALUE);
   double tickSize  = MarketInfo(sym, MODE_TICKSIZE);
   if(tickSize <= 0.0) tickSize = MarketInfo(sym, MODE_POINT);
   if(tickSize <= 0.0) tickSize = 0.00001;
   if(tickValue <= 0.0) tickValue = 1.0;

   double maxRunupPrice = 0.0;
   double maxDrawdownPrice = 0.0;

   if(orderType == OP_BUY)
   {
      maxRunupPrice = highestHigh - entryPrice;
      maxDrawdownPrice = lowestLow - entryPrice; // negative
   }
   else if(orderType == OP_SELL)
   {
      maxRunupPrice = entryPrice - lowestLow;
      maxDrawdownPrice = entryPrice - highestHigh; // negative
   }

   outMfe = (maxRunupPrice / tickSize) * tickValue * volume;
   outMae = (maxDrawdownPrice / tickSize) * tickValue * volume;
}

//+------------------------------------------------------------------+
//| Send HTTP POST Request via WebRequest                            |
//+------------------------------------------------------------------+
bool SendJsonToJournal(string jsonPayload, string &responseOut)
{
   char postData[];
   char resultData[];
   string resultHeaders;
   
   int dataLen = StringToCharArray(jsonPayload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(dataLen > 0)
      ArrayResize(postData, dataLen - 1);

   string headers = "Content-Type: application/json\r\n";
   headers += "Accept: application/json\r\n";
   headers += "User-Agent: PrinceAlgo-TradeJournalSync/3.00\r\n";
   if(StringLen(InpApiKey) > 0)
      headers += "x-api-key: " + InpApiKey + "\r\n";

   ResetLastError();
   int res = WebRequest(
      "POST",
      InpApiUrl,
      headers,
      30000,
      postData,
      resultData,
      resultHeaders
   );

   if(res == -1)
   {
      int err = GetLastError();
      if(err == 4060 || err == 5200)
      {
         g_sync_status = StringFormat("Error: URL not allowed (%d) - Check Options", err);
         g_status_color = clrRed;
         Print("❌ [TradeJournalSync-MT4] ERROR ", err, ": WebRequest not allowed!");
         Print("   FIX: Go to Tools -> Options -> Expert Advisors");
         Print("   1. Check 'Allow WebRequest for listed URL'");
         Print("   2. Click 'Add' and enter: http://127.0.0.1");
         Print("   3. Click OK, then restart the EA");
      }
      else
      {
         g_sync_status = StringFormat("Error: WebRequest failed (%d)", err);
         g_status_color = clrRed;
         PrintFormat("❌ [TradeJournalSync-MT4] WebRequest failed. Error code: %d", err);
      }
      UpdateDashboard();
      return false;
   }

   responseOut = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
   if(res >= 200 && res < 300)
   {
      g_sync_status = "🟢 Connected (Realtime Active)";
      g_status_color = clrLime;
      UpdateDashboard();

      // If server commanded full resync, trigger immediately
      if(StringFind(responseOut, "FORCE_RESYNC") >= 0)
      {
         ForceFullResync();
      }

      return true;
   }
   else
   {
      g_sync_status = StringFormat("⚠️ HTTP %d from server", res);
      g_status_color = clrOrange;
      PrintFormat("⚠️ [TradeJournalSync-MT4] Server HTTP %d: %s", res, responseOut);
      UpdateDashboard();
      return false;
   }
}

//+------------------------------------------------------------------+
//| Build JSON string for Open Positions in MT4                      |
//+------------------------------------------------------------------+
string BuildOpenPositionsJson(double &outFloatingProfit)
{
   string json = "[";
   outFloatingProfit = 0.0;
   int count = 0;
   int total = OrdersTotal();

   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;

      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue; // skip pending orders

      int ticket     = OrderTicket();
      string sym     = OrderSymbol();
      double lots    = OrderLots();
      double openP   = OrderOpenPrice();
      double currP   = OrderClosePrice();
      double prof    = OrderProfit();
      double sl      = OrderStopLoss();
      double tp      = OrderTakeProfit();
      datetime ot    = OrderOpenTime();
      string comm    = OrderComment();
      long magic     = OrderMagicNumber();

      outFloatingProfit += prof;

      string posJson = StringFormat(
         "{\"ticket\":%d,\"symbol\":\"%s\",\"side\":\"%s\",\"quantity\":%.4f,\"openPrice\":%.5f,\"currentPrice\":%.5f,\"profit\":%.2f,\"stopLoss\":%.5f,\"takeProfit\":%.5f,\"openedAt\":\"%s\",\"comment\":\"%s\",\"magic\":%d}",
         ticket, EscapeJson(sym), (type == OP_BUY ? "buy" : "sell"),
         lots, openP, currP, prof, sl, tp, TimeToIso8601Utc(ot), EscapeJson(comm), magic
      );

      if(count > 0) json += ",";
      json += posJson;
      count++;
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Build JSON for Cash Flows in MT4 (Deposits / Withdrawals)        |
//+------------------------------------------------------------------+
string BuildCashFlowsJson(datetime fromTime)
{
   int total = OrdersHistoryTotal();
   string json = "[";
   int count = 0;

   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;

      // In MT4, OrderType == 6 is OP_BALANCE (deposit/withdrawal/credit)
      if(OrderType() == 6)
      {
         datetime closeTime = OrderCloseTime();
         if(fromTime > 0 && closeTime < fromTime) continue;

         double profit = OrderProfit();
         string comment = OrderComment();
         string cfType = (profit >= 0) ? "deposit" : "withdrawal";

         string cfItem = StringFormat(
            "{\"type\":\"%s\",\"amount\":%.2f,\"time\":\"%s\",\"comment\":\"%s\"}",
            cfType, profit, TimeToIso8601Utc(closeTime), EscapeJson(comment)
         );

         if(count > 0) json += ",";
         json += cfItem;
         count++;
      }
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Build JSON string for Account Header in MT4                      |
//+------------------------------------------------------------------+
string BuildAccountJson(datetime fromTime = 0)
{
   int login      = AccountNumber();
   string broker  = AccountCompany();
   string curr    = AccountCurrency();
   double balance = AccountBalance();
   double equity  = AccountEquity();
   int leverage   = AccountLeverage();
   string modeStr = IsDemo() ? "demo" : "real";

   double floatingProfit = 0.0;
   string posJson = BuildOpenPositionsJson(floatingProfit);
   string cashFlowsJson = BuildCashFlowsJson(fromTime);

   string name = InpAccountName;
   if(StringLen(name) == 0)
      name = StringFormat("[%s 1:%d] %s #%d", (modeStr == "real" ? "Real" : "Demo"), leverage, broker, login);

   return StringFormat(
      "\"account\":{\"login\":%d,\"name\":\"%s\",\"broker\":\"%s\",\"currency\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"floatingProfit\":%.2f,\"tradeMode\":\"%s\",\"leverage\":%d,\"positions\":%s,\"cashFlows\":%s}",
      login, EscapeJson(name), EscapeJson(broker), curr, balance, equity, floatingProfit, modeStr, leverage, posJson, cashFlowsJson
   );
}

//+------------------------------------------------------------------+
//| Build Rich JSON for an MT4 Trade Order                           |
//+------------------------------------------------------------------+
string BuildTradeJson(int ticket, string screenshotBase64 = "")
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_HISTORY))
   {
      if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES)) return "";
   }

   int type = OrderType();
   if(type != OP_BUY && type != OP_SELL) return "";

   string sym     = OrderSymbol();
   double lots    = OrderLots();
   double openP   = OrderOpenPrice();
   double closeP  = OrderClosePrice();
   datetime ot    = OrderOpenTime();
   datetime ct    = OrderCloseTime();
   double comm    = OrderCommission();
   double swap    = OrderSwap();
   double profit  = OrderProfit();
   double sl      = OrderStopLoss();
   double tp      = OrderTakeProfit();
   long magic     = OrderMagicNumber();
   string commt   = OrderComment();

   // Determine exit reason from comment or prices
   string reason = "";
   string commLower = commt;
   StringToLower(commLower);
   if(StringFind(commLower, "[tp]") >= 0) reason = "TP";
   else if(StringFind(commLower, "[sl]") >= 0) reason = "SL";
   else if(StringFind(commLower, "[so]") >= 0) reason = "SO";
   else if(ct > 0)
   {
      reason = (magic == 0) ? "CLIENT" : "EXPERT";
   }

   // Calculate MAE & MFE if order is closed
   double mae = 0.0;
   double mfe = 0.0;
   int sampledBars = 0;
   if(ct > 0)
   {
      GetOrderExcursions(sym, type, ot, ct, openP, lots, mae, mfe, sampledBars);
   }

   string json = StringFormat(
      "{\"ticket\":%d,\"symbol\":\"%s\",\"type\":\"%s\",\"lots\":%.4f,\"openPrice\":%.5f,\"closePrice\":%.5f,\"openTime\":\"%s\",\"closeTime\":\"%s\",\"stopLoss\":%.5f,\"takeProfit\":%.5f,\"commission\":%.2f,\"swap\":%.2f,\"profit\":%.2f,\"comment\":\"%s\",\"magic\":%d,\"reason\":\"%s\",\"mae\":%.2f,\"mfe\":%.2f,\"sampledBars\":%d",
      ticket, EscapeJson(sym), (type == OP_BUY ? "buy" : "sell"), lots, openP, closeP,
      TimeToIso8601Utc(ot), (ct > 0 ? TimeToIso8601Utc(ct) : ""),
      sl, tp, comm, swap, profit, EscapeJson(commt), magic, reason, mae, mfe, sampledBars
   );

   if(StringLen(screenshotBase64) > 0)
   {
      json += ",\"screenshotBase64\":\"" + screenshotBase64 + "\"";
   }

   json += "}";
   return json;
}

//+------------------------------------------------------------------+
//| Sync Full History in Batches for MT4                             |
//+------------------------------------------------------------------+
int SyncHistoryBatched(datetime fromTime)
{
   int total = OrdersHistoryTotal();
   PrintFormat("📊 [DIAG] OrdersHistoryTotal() = %d", total);
   PrintFormat("📊 [DIAG] fromTime filter = %s", (fromTime > 0 ? TimeToString(fromTime, TIME_DATE|TIME_MINUTES) : "NONE (All History)"));

   if(total == 0)
   {
      Print("⚠️ [TradeJournalSync-MT4] MT4 reports 0 history orders!");
      Print("   FIX: In MT4 Terminal, go to 'Account History' tab, right-click -> 'All History'");
      g_sync_status = "⚠️ No history found (check Account History tab)";
      g_status_color = clrOrange;
      UpdateDashboard();
      
      // Still send account info
      string payload = "{";
      if(StringLen(InpApiKey) > 0) payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
      payload += BuildAccountJson(fromTime) + ",\"trades\":[]}";
      string resp;
      SendJsonToJournal(payload, resp);
      return 0;
   }

   int validTickets[];
   int skippedPending = 0;
   int skippedBalance = 0;
   int skippedDate = 0;

   for(int i = 0; i < total; i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      int type = OrderType();
      
      if(type != OP_BUY && type != OP_SELL)
      {
         if(type == 6) skippedBalance++;
         else skippedPending++;
         continue;
      }

      datetime ct = OrderCloseTime();
      if(fromTime > 0 && ct < fromTime)
      {
         skippedDate++;
         continue;
      }

      int sz = ArraySize(validTickets);
      ArrayResize(validTickets, sz + 1);
      validTickets[sz] = OrderTicket();
   }

   int totalTradingOrders = ArraySize(validTickets);
   PrintFormat("📊 [DIAG] Total history entries: %d | Valid trades: %d | Balance ops: %d | Pending: %d | Filtered by date: %d",
      total, totalTradingOrders, skippedBalance, skippedPending, skippedDate);

   if(totalTradingOrders == 0)
   {
      Print("⚠️ [TradeJournalSync-MT4] No valid closed trades found in history");
      string payload = "{";
      if(StringLen(InpApiKey) > 0) payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
      payload += BuildAccountJson(fromTime) + ",\"trades\":[]}";
      string resp;
      SendJsonToJournal(payload, resp);
      return 0;
   }

   PrintFormat("🔍 [TradeJournalSync-MT4] Found %d trade orders to sync", totalTradingOrders);

   int batchSize = MathMax(10, MathMin(200, InpBatchSize));
   int totalBatches = (int)MathCeil((double)totalTradingOrders / batchSize);
   int syncedCount = 0;

   for(int b = 0; b < totalBatches; b++)
   {
      int startIdx = b * batchSize;
      int endIdx = MathMin(startIdx + batchSize, totalTradingOrders);

      string tradesJson = "";
      int countInBatch = 0;

      for(int i = startIdx; i < endIdx; i++)
      {
         string tradeJson = BuildTradeJson(validTickets[i]);
         if(StringLen(tradeJson) > 0)
         {
            if(countInBatch > 0) tradesJson += ",";
            tradesJson += tradeJson;
            countInBatch++;
         }
      }

      string payload = "{";
      if(StringLen(InpApiKey) > 0)
         payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
      payload += BuildAccountJson(fromTime);
      payload += ",\"trades\":[" + tradesJson + "]}";

      string resp;
      g_sync_status = StringFormat("Syncing batch %d/%d (%d orders)...", b + 1, totalBatches, countInBatch);
      g_status_color = clrYellow;
      UpdateDashboard();

      if(SendJsonToJournal(payload, resp))
      {
         syncedCount += countInBatch;
         PrintFormat("✅ [TradeJournalSync-MT4] Batch %d/%d synced (%d orders)", b + 1, totalBatches, countInBatch);
      }
      else
      {
         PrintFormat("❌ [TradeJournalSync-MT4] Failed at batch %d/%d", b + 1, totalBatches);
         break;
      }
      Sleep(50);
   }

   g_total_orders_synced = syncedCount;
   g_last_synced_time = TimeCurrent();
   g_sync_status = "🟢 Connected (Realtime Active)";
   g_status_color = clrLime;
   UpdateDashboard();

   PrintFormat("🎉 [TradeJournalSync-MT4] History sync complete! Total: %d orders", syncedCount);
   return syncedCount;
}

//+------------------------------------------------------------------+
//| Trigger Full Sync Based on Input Options                         |
//+------------------------------------------------------------------+
void TriggerFullSync()
{
   datetime fromTime = 0;
   if(InpSyncScope == SYNC_ALL_HISTORY)
      fromTime = 0;
   else if(InpSyncScope == SYNC_PAST_DAYS)
      fromTime = TimeCurrent() - (InpSyncDays * 86400);
   else if(InpSyncScope == SYNC_FROM_DATE)
      fromTime = InpSyncStartDate;

   SyncHistoryBatched(fromTime);
}

//+------------------------------------------------------------------+
//| Force Full Historical Resync & Overwrite Database                |
//+------------------------------------------------------------------+
void ForceFullResync()
{
   Print("⚡ [TradeJournalSync-MT4] Executing FORCE FULL RESYNC... reading ALL orders and overwriting to journal.");
   SyncHistoryBatched(0);
}

//+------------------------------------------------------------------+
//| Update Tracked Open Tickets List                                 |
//+------------------------------------------------------------------+
void UpdateTrackedTickets()
{
   int total = OrdersTotal();
   ArrayResize(g_open_tickets, 0);

   for(int i = 0; i < total; i++)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
      {
         int type = OrderType();
         if(type == OP_BUY || type == OP_SELL)
         {
            int sz = ArraySize(g_open_tickets);
            ArrayResize(g_open_tickets, sz + 1);
            g_open_tickets[sz] = OrderTicket();
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Check for Realtime Open / Close Events in MT4                    |
//+------------------------------------------------------------------+
void CheckRealtimeEvents()
{
   int totalOpen = OrdersTotal();
   
   // 1. Check for newly opened orders
   for(int i = 0; i < totalOpen; i++)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
      {
         int type = OrderType();
         if(type == OP_BUY || type == OP_SELL)
         {
            int ticket = OrderTicket();
            bool isKnown = false;
            for(int k = 0; k < ArraySize(g_open_tickets); k++)
            {
               if(g_open_tickets[k] == ticket) { isKnown = true; break; }
            }

            if(!isKnown)
            {
               // New position opened in realtime!
               string screenshotBase64 = "";
               if(InpAutoScreenshot) screenshotBase64 = CaptureChartScreenshotBase64(ticket, OrderSymbol());

               string tradeJson = BuildTradeJson(ticket, screenshotBase64);
               string payload = "{";
               if(StringLen(InpApiKey) > 0) payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
               payload += BuildAccountJson() + ",\"trades\":[" + tradeJson + "]}";

               string resp;
               if(SendJsonToJournal(payload, resp))
               {
                  PrintFormat("⚡ [TradeJournalSync-MT4] Realtime order opened: #%d (%s)", ticket, OrderSymbol());
               }
            }
         }
      }
   }

   // 2. Check for newly closed orders
   for(int k = 0; k < ArraySize(g_open_tickets); k++)
   {
      int ticket = g_open_tickets[k];
      // If no longer in active trades, check if it moved to history
      if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES))
      {
         if(OrderSelect(ticket, SELECT_BY_TICKET, MODE_HISTORY))
         {
            // Position was just closed!
            string screenshotBase64 = "";
            if(InpAutoScreenshot) screenshotBase64 = CaptureChartScreenshotBase64(ticket, OrderSymbol());

            string tradeJson = BuildTradeJson(ticket, screenshotBase64);
            string payload = "{";
            if(StringLen(InpApiKey) > 0) payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
            payload += BuildAccountJson() + ",\"trades\":[" + tradeJson + "]}";

            string resp;
            if(SendJsonToJournal(payload, resp))
            {
               g_total_orders_synced++;
               PrintFormat("⚡ [TradeJournalSync-MT4] Realtime order closed: #%d (%s) Profit: %.2f", 
                  ticket, OrderSymbol(), OrderProfit());
            }
         }
      }
   }

   UpdateTrackedTickets();
   g_last_synced_time = TimeCurrent();
   UpdateDashboard();
}

//+------------------------------------------------------------------+
//| On-Chart GUI Dashboard Creation                                  |
//+------------------------------------------------------------------+
void CreateDashboard()
{
   if(!InpShowDashboard) return;

   int x = 20;
   int y = 30;
   int width = 330;
   int height = 242;

   // Background Panel
   ObjectCreate(0, GUI_PREFIX + "BG", OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, GUI_PREFIX + "BG", OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, GUI_PREFIX + "BG", OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, GUI_PREFIX + "BG", OBJPROP_XSIZE, width);
   ObjectSetInteger(0, GUI_PREFIX + "BG", OBJPROP_YSIZE, height);
   ObjectSetInteger(0, GUI_PREFIX + "BG", OBJPROP_BGCOLOR, C'20,24,33');
   ObjectSetInteger(0, GUI_PREFIX + "BG", OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, GUI_PREFIX + "BG", OBJPROP_COLOR, C'40,48,64');
   ObjectSetInteger(0, GUI_PREFIX + "BG", OBJPROP_CORNER, CORNER_LEFT_UPPER);

   // Title
   CreateLabel("Title", "⚡ TRADE JOURNAL SYNC (MT4 PRO)", x + 15, y + 12, clrWhite, 10, true);

   // Labels
   CreateLabel("Account", "Account: -", x + 15, y + 36, clrSilver, 9);
   CreateLabel("Balance", "Balance: -", x + 15, y + 56, clrSilver, 9);
   CreateLabel("Positions", "Open Positions: -", x + 15, y + 76, clrSilver, 9);
   CreateLabel("GmtOffset", "Server Time: -", x + 15, y + 96, clrSilver, 8);
   CreateLabel("Visuals", "Visuals: -", x + 15, y + 114, clrSilver, 8);
   CreateLabel("Status", "Status: Initializing...", x + 15, y + 132, clrYellow, 9);
   CreateLabel("Synced", "History Orders Synced: 0", x + 15, y + 152, clrSilver, 9);
   CreateLabel("LastTime", "Last Sync: -", x + 15, y + 170, clrGray, 8);

   // Status Visual Banner
   CreateLabel("AutoBadge", "● AUTO-SYNC: ACTIVE (Continuous Live Sync)", x + 15, y + 188, C'52,211,153', 8, true);

   // Manual On-Chart Resync Button
   string btnName = GUI_PREFIX + "BtnResync";
   ObjectCreate(0, btnName, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, btnName, OBJPROP_XDISTANCE, x + 15);
   ObjectSetInteger(0, btnName, OBJPROP_YDISTANCE, y + 208);
   ObjectSetInteger(0, btnName, OBJPROP_XSIZE, width - 30);
   ObjectSetInteger(0, btnName, OBJPROP_YSIZE, 22);
   ObjectSetString(0, btnName, OBJPROP_TEXT, "🔄 Force Full Resync Now");
   ObjectSetInteger(0, btnName, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, btnName, OBJPROP_BGCOLOR, C'37,99,235');
   ObjectSetInteger(0, btnName, OBJPROP_BORDER_COLOR, C'59,130,246');
   ObjectSetInteger(0, btnName, OBJPROP_FONTSIZE, 8);
   ObjectSetString(0, btnName, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(0, btnName, OBJPROP_CORNER, CORNER_LEFT_UPPER);

   ChartRedraw(0);
}

void CreateLabel(string name, string text, int x, int y, color clr, int fontSize, bool isBold=false)
{
   string objName = GUI_PREFIX + name;
   ObjectCreate(0, objName, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, objName, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, objName, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, objName, OBJPROP_TEXT, text);
   ObjectSetInteger(0, objName, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, objName, OBJPROP_FONTSIZE, fontSize);
   ObjectSetString(0, objName, OBJPROP_FONT, isBold ? "Arial Bold" : "Arial");
   ObjectSetInteger(0, objName, OBJPROP_CORNER, CORNER_LEFT_UPPER);
}

void UpdateDashboard()
{
   if(!InpShowDashboard) return;

   int login      = AccountNumber();
   string broker  = AccountCompany();
   string curr    = AccountCurrency();
   double bal     = AccountBalance();
   double eq      = AccountEquity();
   double floating= eq - bal;
   int gmtOffHours= GetBrokerGmtOffset() / 3600;
   int lev        = AccountLeverage();
   string mode    = IsDemo() ? "DEMO" : "REAL";

   ObjectSetString(0, GUI_PREFIX + "Account", OBJPROP_TEXT, 
      StringFormat("[%s 1:%d] #%d (%s)", mode, lev, login, broker));
   
   ObjectSetString(0, GUI_PREFIX + "Balance", OBJPROP_TEXT, 
      StringFormat("Balance / Eq: %.2f / %.2f %s (%+.2f)", bal, eq, curr, floating));

   ObjectSetString(0, GUI_PREFIX + "Positions", OBJPROP_TEXT, 
      StringFormat("Open Positions: %d active", OrdersTotal()));

   ObjectSetString(0, GUI_PREFIX + "GmtOffset", OBJPROP_TEXT, 
      StringFormat("Server Offset: GMT%+d (UTC active)", gmtOffHours));

   ObjectSetString(0, GUI_PREFIX + "Visuals", OBJPROP_TEXT, 
      StringFormat("MAE/MFE: Active | Screenshot: %s", (InpAutoScreenshot ? "ON" : "OFF")));

   ObjectSetString(0, GUI_PREFIX + "Status", OBJPROP_TEXT, "Status: " + g_sync_status);
   ObjectSetInteger(0, GUI_PREFIX + "Status", OBJPROP_COLOR, g_status_color);

   ObjectSetString(0, GUI_PREFIX + "Synced", OBJPROP_TEXT, 
      StringFormat("History Orders Synced: %d", g_total_orders_synced));

   string lastT = (g_last_synced_time > 0) ? TimeToString(g_last_synced_time, TIME_DATE|TIME_SECONDS) : "-";
   ObjectSetString(0, GUI_PREFIX + "LastTime", OBJPROP_TEXT, "Last Sync: " + lastT);

   ChartRedraw(0);
}

void DestroyDashboard()
{
   ObjectsDeleteAll(0, GUI_PREFIX);
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Chart Event Handler                                              |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   // Interactive chart events (clean, no manual button needed)
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("🚀 [TradeJournalSync-MT4] Initializing Complete MT4 Sync EA (Pro)...");
   PrintFormat("🔗 Webhook URL: %s", InpApiUrl);
   PrintFormat("💼 Account: %d (%s)", AccountNumber(), AccountCompany());
   PrintFormat("🌍 Broker GMT Offset: %+d hours", GetBrokerGmtOffset() / 3600);

   CreateDashboard();
   UpdateTrackedTickets();

   // Use 1-second timer for heartbeat and realtime polling
   EventSetTimer(1);

   TriggerFullSync();

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   DestroyDashboard();
   Print("🛑 [TradeJournalSync-MT4] EA Deinitialized cleanly.");
}

//+------------------------------------------------------------------+
//| OnTick Handler                                                   |
//+------------------------------------------------------------------+
void OnTick()
{
   CheckRealtimeEvents();
}

//+------------------------------------------------------------------+
//| OnTimer Handler                                                  |
//+------------------------------------------------------------------+
void OnTimer()
{
   static int timerCounter = 0;
   timerCounter++;

   // Check order state changes every second
   CheckRealtimeEvents();

   // Periodic heartbeat every InpHeartbeatSec seconds
   if(timerCounter >= InpHeartbeatSec)
   {
      timerCounter = 0;

      // Scan all valid closed trades so dashboard stays 100% continuously complete & synced
      int totalHist = OrdersHistoryTotal();
      string tradesJson = "";
      int countInHeartbeat = 0;

      for(int i = 0; i < totalHist; i++)
      {
         if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
         int type = OrderType();
         if(type != OP_BUY && type != OP_SELL) continue;

         string tJson = BuildTradeJson(OrderTicket());
         if(StringLen(tJson) > 0)
         {
            if(countInHeartbeat > 0) tradesJson += ",";
            tradesJson += tJson;
            countInHeartbeat++;
         }
      }

      string payload = "{";
      if(StringLen(InpApiKey) > 0) payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
      payload += BuildAccountJson() + ",\"trades\":[" + tradesJson + "]}";

      string resp;
      SendJsonToJournal(payload, resp);
      g_last_synced_time = TimeCurrent();
      UpdateDashboard();
   }
}

//+------------------------------------------------------------------+
//| Chart Event Handler                                              |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_OBJECT_CLICK && sparam == GUI_PREFIX + "BtnResync")
   {
      ObjectSetInteger(0, GUI_PREFIX + "BtnResync", OBJPROP_STATE, false);
      Print("🔄 [TradeJournalSync-MT4] User clicked Force Full Resync button on chart!");
      ForceFullResync();
      ChartRedraw(0);
   }
}
//+------------------------------------------------------------------+
