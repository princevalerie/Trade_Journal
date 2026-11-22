//+------------------------------------------------------------------+
//|                                           TradeJournalSync.mq5   |
//|                 Trade Journal Multi-Account Realtime & History   |
//|                Institutional Edition for MetaTrader 5            |
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
input group "=== 1. Journal Backend Connection ==="
input string            InpApiUrl          = "https://journal-valbury-prince.vercel.app/api/webhooks/mt5"; // Webhook URL
input string            InpApiKey          = "Valbury05@";                                             // API Secret Key (MT_WEBHOOK_SECRET)
input string            InpAccountName     = "";                                                       // Custom Account Name (optional)

input group "=== 2. History Synchronization ==="
input ENUM_SYNC_SCOPE   InpSyncScope       = SYNC_ALL_HISTORY;                         // History Sync Scope
input int               InpSyncDays        = 365;                                      // Past Days (if Past N Days selected)
input datetime          InpSyncStartDate   = D'2020.01.01 00:00:00';                   // Start Date (if Specific Date selected)
input int               InpBatchSize       = 100;                                      // Batch Size (deals per HTTP request)

input group "=== 3. Monitoring & Heartbeat ==="
input int               InpHeartbeatSec    = 15;                                       // Live Heartbeat & Positions (seconds)
input bool              InpShowDashboard   = true;                                     // Show On-Chart GUI Dashboard

input group "=== 4. Visuals & Chart Screenshots ==="
input bool              InpAutoScreenshot  = true;                                     // Auto Capture Chart Screenshot on Trade
input int               InpScreenshotWidth = 800;                                      // Screenshot Width (pixels)
input int               InpScreenshotHeight= 450;                                      // Screenshot Height (pixels)

//--- GUI Object Prefixes
#define GUI_PREFIX "TJS_"

//--- Global Variables
datetime g_last_synced_time  = 0;
int      g_total_deals_synced= 0;
int      g_last_history_total= 0;
string   g_sync_status       = "Initializing...";
color    g_status_color      = clrYellow;

//+------------------------------------------------------------------+
//| Calculate Broker GMT Offset in Seconds (Rounded to Half-Hour)    |
//+------------------------------------------------------------------+
int GetBrokerGmtOffset()
{
   datetime serverNow = TimeCurrent();
   datetime gmtNow    = TimeGMT();
   double rawDiff     = (double)(serverNow - gmtNow);
   // Round to nearest 30 minutes (1800s) to prevent tick latency drift
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
//| Infer asset class from symbol                                    |
//+------------------------------------------------------------------+
string DetectAssetClass(string symbol)
{
   string upper = symbol;
   StringToUpper(upper);
   
   if(StringFind(upper, "BTC") >= 0 || StringFind(upper, "ETH") >= 0 || 
      StringFind(upper, "SOL") >= 0 || StringFind(upper, "XRP") >= 0 ||
      StringFind(upper, "CRYPTO") >= 0)
      return "crypto";
   
   if(StringFind(upper, "US500") >= 0 || StringFind(upper, "US30") >= 0 || 
      StringFind(upper, "NAS") >= 0   || StringFind(upper, "GER") >= 0 ||
      StringFind(upper, "SPX") >= 0   || StringFind(upper, "WS30") >= 0 ||
      StringFind(upper, "OIL") >= 0   || StringFind(upper, "WTI") >= 0 ||
      StringFind(upper, "XAU") >= 0   || StringFind(upper, "GOLD") >= 0 ||
      StringFind(upper, "XAG") >= 0)
      return "cfd";
   
   return "forex";
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
   return 0;
}

//+------------------------------------------------------------------+
//| Capture Chart Screenshot and Encode to Base64                    |
//+------------------------------------------------------------------+
string CaptureChartScreenshotBase64(ulong ticket, string sym = "")
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

   string filename = StringFormat("TradeJournal_%I64d.png", ticket);
   ResetLastError();
   
   if(!ChartScreenShot(targetChartId, filename, InpScreenshotWidth, InpScreenshotHeight, ALIGN_RIGHT))
   {
      PrintFormat("⚠️ [TradeJournalSync] ChartScreenShot failed (%d) for symbol: %s", GetLastError(), sym);
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
   FileDelete(filename); // remove temp file

   uchar key[];
   uchar base64Bytes[];
   if(CryptEncode(CRYPT_BASE64, fileBytes, key, base64Bytes) > 0)
   {
      return CharArrayToString(base64Bytes, 0, WHOLE_ARRAY, CP_ACP);
   }
   return "";
}

//+------------------------------------------------------------------+
//| Calculate MAE & MFE from M1 historical bars                      |
//+------------------------------------------------------------------+
void GetDealExcursions(
   ulong dealTicket,
   long posId,
   string sym,
   datetime exitTime,
   double &outMae,
   double &outMfe,
   int &outBars
)
{
   outMae = 0.0;
   outMfe = 0.0;
   outBars = 0;

   if(posId <= 0) return;
   if(!HistorySelectByPosition(posId)) return;

   datetime entryTime = 0;
   double entryPrice = 0.0;
   long entryDealType = -1;
   double volume = 0.0;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong t = HistoryDealGetTicket(i);
      if(t > 0 && HistoryDealGetInteger(t, DEAL_ENTRY) == DEAL_ENTRY_IN)
      {
         entryTime = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
         entryPrice = HistoryDealGetDouble(t, DEAL_PRICE);
         entryDealType = HistoryDealGetInteger(t, DEAL_TYPE);
         volume = HistoryDealGetDouble(t, DEAL_VOLUME);
         break;
      }
   }

   if(entryTime <= 0 || entryPrice <= 0.0 || entryTime >= exitTime) return;

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(sym, PERIOD_M1, entryTime, exitTime, rates);
   if(copied <= 0) return;

   outBars = copied;
   double lowestLow = rates[0].low;
   double highestHigh = rates[0].high;

   for(int r = 1; r < copied; r++)
   {
      if(rates[r].low < lowestLow) lowestLow = rates[r].low;
      if(rates[r].high > highestHigh) highestHigh = rates[r].high;
   }

   double tickValue = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize <= 0.0) tickSize = SymbolInfoDouble(sym, SYMBOL_POINT);
   if(tickSize <= 0.0) tickSize = 0.00001;
   if(tickValue <= 0.0) tickValue = 1.0;

   double maxRunupPrice = 0.0;
   double maxDrawdownPrice = 0.0;

   if(entryDealType == DEAL_TYPE_BUY)
   {
      maxRunupPrice = highestHigh - entryPrice;
      maxDrawdownPrice = lowestLow - entryPrice; // negative
   }
   else if(entryDealType == DEAL_TYPE_SELL)
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
      if(err == 4060)
      {
         g_sync_status = "Error: WebRequest 4060 (Check Tools -> Options)";
         g_status_color = clrRed;
         Print("❌ [TradeJournalSync] ERROR 4060: WebRequest not allowed! Go to Tools -> Options -> Expert Advisors, check 'Allow WebRequest for listed URL' and add: ", InpApiUrl);
      }
      else
      {
         g_sync_status = StringFormat("Error: WebRequest failed (%d)", err);
         g_status_color = clrRed;
         PrintFormat("❌ [TradeJournalSync] WebRequest failed. Error code: %d", err);
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
      return true;
   }
   else
   {
      g_sync_status = StringFormat("⚠️ HTTP %d from server", res);
      g_status_color = clrOrange;
      PrintFormat("⚠️ [TradeJournalSync] Server HTTP %d: %s", res, responseOut);
      UpdateDashboard();
      return false;
   }
}

//+------------------------------------------------------------------+
//| Build JSON string for Open Positions                             |
//+------------------------------------------------------------------+
string BuildOpenPositionsJson(double &outFloatingProfit)
{
   string json = "[";
   outFloatingProfit = 0.0;
   int count = 0;
   int total = PositionsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      string sym   = PositionGetString(POSITION_SYMBOL);
      long type    = PositionGetInteger(POSITION_TYPE);
      double vol   = PositionGetDouble(POSITION_VOLUME);
      double openP = PositionGetDouble(POSITION_PRICE_OPEN);
      double currP = PositionGetDouble(POSITION_PRICE_CURRENT);
      double prof  = PositionGetDouble(POSITION_PROFIT);
      double sl    = PositionGetDouble(POSITION_SL);
      double tp    = PositionGetDouble(POSITION_TP);
      datetime ot  = (datetime)PositionGetInteger(POSITION_TIME);
      string comm  = PositionGetString(POSITION_COMMENT);

      outFloatingProfit += prof;

      string posJson = StringFormat(
         "{\"ticket\":%I64d,\"symbol\":\"%s\",\"side\":\"%s\",\"quantity\":%.4f,\"openPrice\":%.5f,\"currentPrice\":%.5f,\"profit\":%.2f,\"stopLoss\":%.5f,\"takeProfit\":%.5f,\"openedAt\":\"%s\",\"comment\":\"%s\"}",
         ticket, EscapeJson(sym), (type == POSITION_TYPE_BUY ? "buy" : "sell"),
         vol, openP, currP, prof, sl, tp, TimeToIso8601Utc(ot), EscapeJson(comm)
      );

      if(count > 0) json += ",";
      json += posJson;
      count++;
   }
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Build JSON for Cash Flows (Deposits and Withdrawals)             |
//+------------------------------------------------------------------+
string BuildCashFlowsJson(datetime fromTime, datetime toTime)
{
   if(!HistorySelect(fromTime, toTime)) return "[]";
   int total = HistoryDealsTotal();
   string json = "[";
   int count = 0;

   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      long type = HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(type == DEAL_TYPE_BALANCE || type == DEAL_TYPE_CREDIT)
      {
         double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
         datetime dealTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
         string comment = HistoryDealGetString(ticket, DEAL_COMMENT);
         string cfType = (profit >= 0) ? "deposit" : "withdrawal";

         string cfItem = StringFormat(
            "{\"type\":\"%s\",\"amount\":%.2f,\"time\":\"%s\",\"comment\":\"%s\"}",
            cfType, profit, TimeToIso8601Utc(dealTime), EscapeJson(comment)
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
//| Build JSON string for Account Header                             |
//+------------------------------------------------------------------+
string BuildAccountJson(datetime fromTime = 0, datetime toTime = 0)
{
   long login     = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker  = AccountInfoString(ACCOUNT_COMPANY);
   string curr    = AccountInfoString(ACCOUNT_CURRENCY);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);

   long tradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string modeStr = "real";
   if(tradeMode == ACCOUNT_TRADE_MODE_DEMO) modeStr = "demo";
   else if(tradeMode == ACCOUNT_TRADE_MODE_CONTEST) modeStr = "contest";

   long leverage = AccountInfoInteger(ACCOUNT_LEVERAGE);

   double floatingProfit = 0.0;
   string posJson = BuildOpenPositionsJson(floatingProfit);

   datetime cfTo = (toTime > 0) ? toTime : TimeCurrent() + 86400;
   string cashFlowsJson = BuildCashFlowsJson(fromTime, cfTo);

   string name = InpAccountName;
   if(StringLen(name) == 0)
      name = StringFormat("[%s 1:%I64d] %s #%I64d", (modeStr == "real" ? "Real" : "Demo"), leverage, broker, login);

   return StringFormat(
      "\"account\":{\"login\":%I64d,\"name\":\"%s\",\"broker\":\"%s\",\"currency\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"floatingProfit\":%.2f,\"tradeMode\":\"%s\",\"leverage\":%I64d,\"positions\":%s,\"cashFlows\":%s}",
      login, EscapeJson(name), EscapeJson(broker), curr, balance, equity, floatingProfit, modeStr, leverage, posJson, cashFlowsJson
   );
}

//+------------------------------------------------------------------+
//| Build Rich JSON for a Single Deal                                |
//+------------------------------------------------------------------+
string BuildDealJson(ulong ticket, string screenshotBase64 = "")
{
   if(!HistoryDealSelect(ticket)) return "";

   long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_IN && entry != DEAL_ENTRY_OUT && 
      entry != DEAL_ENTRY_INOUT && entry != DEAL_ENTRY_OUT_BY)
      return "";

   long dealType = HistoryDealGetInteger(ticket, DEAL_TYPE);
   string side = "";
   if(dealType == DEAL_TYPE_BUY) side = "buy";
   else if(dealType == DEAL_TYPE_SELL) side = "sell";
   else return "";

   string sym    = HistoryDealGetString(ticket, DEAL_SYMBOL);
   double vol    = HistoryDealGetDouble(ticket, DEAL_VOLUME);
   double price  = HistoryDealGetDouble(ticket, DEAL_PRICE);
   double comm   = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
   double swap   = HistoryDealGetDouble(ticket, DEAL_SWAP);
   double feeBrok= HistoryDealGetDouble(ticket, DEAL_FEE);
   double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
   double fee    = MathAbs(comm) + MathAbs(feeBrok);
   double netProfit = profit + swap; // incorporate financing swap so positive swap increases profit
   datetime t    = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
   long orderId  = HistoryDealGetInteger(ticket, DEAL_ORDER);
   long posId    = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
   long magic    = HistoryDealGetInteger(ticket, DEAL_MAGIC);
   string commt  = HistoryDealGetString(ticket, DEAL_COMMENT);

   // Extract Stop Loss, Take Profit, Order Type and Slippage
   double orderSl = 0.0;
   double orderTp = 0.0;
   string orderTypeStr = "";
   double slippagePips = 0.0;

   // 1. Check current deal's order
   if(orderId > 0 && HistoryOrderSelect(orderId))
   {
      if(magic == 0) magic = HistoryOrderGetInteger(orderId, ORDER_MAGIC);
      if(StringLen(commt) == 0) commt = HistoryOrderGetString(orderId, ORDER_COMMENT);
      orderSl = HistoryOrderGetDouble(orderId, ORDER_SL);
      orderTp = HistoryOrderGetDouble(orderId, ORDER_TP);
      double orderReqPrice = HistoryOrderGetDouble(orderId, ORDER_PRICE_OPEN);
      long ordType = HistoryOrderGetInteger(orderId, ORDER_TYPE);

      if(ordType == ORDER_TYPE_BUY) orderTypeStr = "BUY";
      else if(ordType == ORDER_TYPE_SELL) orderTypeStr = "SELL";
      else if(ordType == ORDER_TYPE_BUY_LIMIT) orderTypeStr = "BUY_LIMIT";
      else if(ordType == ORDER_TYPE_SELL_LIMIT) orderTypeStr = "SELL_LIMIT";
      else if(ordType == ORDER_TYPE_BUY_STOP) orderTypeStr = "BUY_STOP";
      else if(ordType == ORDER_TYPE_SELL_STOP) orderTypeStr = "SELL_STOP";

      if(orderReqPrice > 0.0 && price > 0.0)
      {
         double point = SymbolInfoDouble(sym, SYMBOL_POINT);
         int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
         double pipSize = (digits == 3 || digits == 5) ? point * 10.0 : point;
         if(pipSize > 0.0)
         {
            slippagePips = (price - orderReqPrice) / pipSize;
         }
      }
   }

   // 2. In MT5, exit deals lose magic/SL/TP. Check the original position entry order (ticket == posId):
   if(posId > 0 && HistoryOrderSelect(posId))
   {
      if(magic == 0) magic = HistoryOrderGetInteger(posId, ORDER_MAGIC);
      if(StringLen(commt) == 0) commt = HistoryOrderGetString(posId, ORDER_COMMENT);
      if(orderSl <= 0.0) orderSl = HistoryOrderGetDouble(posId, ORDER_SL);
      if(orderTp <= 0.0) orderTp = HistoryOrderGetDouble(posId, ORDER_TP);
   }

   // 3. Scan deals to find the opening deal (DEAL_ENTRY_IN) for this position
   if((magic == 0 || StringLen(commt) == 0) && posId > 0)
   {
      int dealsTotal = HistoryDealsTotal();
      for(int d = 0; d < dealsTotal; d++)
      {
         ulong dt = HistoryDealGetTicket(d);
         if(dt == 0) continue;
         if((long)HistoryDealGetInteger(dt, DEAL_POSITION_ID) == posId)
         {
            long ent = HistoryDealGetInteger(dt, DEAL_ENTRY);
            if(ent == DEAL_ENTRY_IN)
            {
               if(magic == 0) magic = HistoryDealGetInteger(dt, DEAL_MAGIC);
               if(StringLen(commt) == 0) commt = HistoryDealGetString(dt, DEAL_COMMENT);
               break;
            }
         }
      }
   }


   // Extract Exit Reason
   int reasonCode = (int)HistoryDealGetInteger(ticket, DEAL_REASON);
   string reasonStr = "";
   switch(reasonCode)
   {
      case DEAL_REASON_CLIENT: reasonStr = "CLIENT"; break;
      case DEAL_REASON_EXPERT: reasonStr = "EXPERT"; break;
      case DEAL_REASON_TP:     reasonStr = "TP"; break;
      case DEAL_REASON_SL:     reasonStr = "SL"; break;
      case DEAL_REASON_SO:     reasonStr = "SO"; break;
      default:                 reasonStr = ""; break;
   }

   // Extract MAE & MFE for closing deals
   double mae = 0.0;
   double mfe = 0.0;
   int sampledBars = 0;
   if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY)
   {
      GetDealExcursions(ticket, posId, sym, t, mae, mfe, sampledBars);
   }

   string assetClass = DetectAssetClass(sym);

   string json = StringFormat(
      "{\"ticket\":%I64d,\"orderId\":%I64d,\"positionId\":%I64d,\"symbol\":\"%s\",\"side\":\"%s\",\"quantity\":%.4f,\"price\":%.5f,\"fee\":%.2f,\"profit\":%.2f,\"commission\":%.2f,\"swap\":%.2f,\"executedAt\":\"%s\",\"assetClass\":\"%s\",\"comment\":\"%s\",\"magic\":%I64d,\"stopLoss\":%.5f,\"takeProfit\":%.5f,\"reason\":\"%s\",\"orderType\":\"%s\",\"slippagePips\":%.2f,\"mae\":%.2f,\"mfe\":%.2f,\"sampledBars\":%d",
      ticket, orderId, posId, EscapeJson(sym), side, vol, price, fee, netProfit, comm, swap,
      TimeToIso8601Utc(t), assetClass, EscapeJson(commt), magic,
      orderSl, orderTp, reasonStr, orderTypeStr, slippagePips, mae, mfe, sampledBars
   );

   if(StringLen(screenshotBase64) > 0)
   {
      json += ",\"screenshotBase64\":\"" + screenshotBase64 + "\"";
   }

   json += "}";
   return json;
}

//+------------------------------------------------------------------+
//| Sync Full History in Batches                                     |
//+------------------------------------------------------------------+
int SyncHistoryBatched(datetime fromTime, datetime toTime)
{
   PrintFormat("⏳ [TradeJournalSync] Querying history from %s to %s (UTC offset: %d sec)...", 
      TimeToString(fromTime, TIME_DATE|TIME_MINUTES), TimeToString(toTime, TIME_DATE|TIME_MINUTES), GetBrokerGmtOffset());

   if(!HistorySelect(fromTime, toTime))
   {
      Print("⚠️ [TradeJournalSync] Failed to select history");
      return 0;
   }

   int totalDeals = HistoryDealsTotal();
   ulong validTickets[];

   for(int i = 0; i < totalDeals; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_OUT || 
         entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY)
      {
         int sz = ArraySize(validTickets);
         ArrayResize(validTickets, sz + 1);
         validTickets[sz] = ticket;
      }
   }

   int totalTradingDeals = ArraySize(validTickets);
   PrintFormat("🔍 [TradeJournalSync] Found %d trade executions to sync", totalTradingDeals);

   if(totalTradingDeals == 0)
   {
      string payload = "{";
      if(StringLen(InpApiKey) > 0) payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
      payload += BuildAccountJson(fromTime, toTime) + ",\"executions\":[]}";
      string resp;
      SendJsonToJournal(payload, resp);
      return 0;
   }

   int batchSize = MathMax(10, MathMin(200, InpBatchSize));
   int totalBatches = (int)MathCeil((double)totalTradingDeals / batchSize);
   int syncedCount = 0;

   for(int b = 0; b < totalBatches; b++)
   {
      int startIdx = b * batchSize;
      int endIdx = MathMin(startIdx + batchSize, totalTradingDeals);

      string executionsJson = "";
      int countInBatch = 0;

      for(int i = startIdx; i < endIdx; i++)
      {
         string dealJson = BuildDealJson(validTickets[i]);
         if(StringLen(dealJson) > 0)
         {
            if(countInBatch > 0) executionsJson += ",";
            executionsJson += dealJson;
            countInBatch++;
         }
      }

      string payload = "{";
      if(StringLen(InpApiKey) > 0)
         payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
      payload += BuildAccountJson(fromTime, toTime);
      payload += ",\"executions\":[" + executionsJson + "]}";

      string resp;
      g_sync_status = StringFormat("Syncing batch %d/%d (%d deals)...", b + 1, totalBatches, countInBatch);
      g_status_color = clrYellow;
      UpdateDashboard();

      if(SendJsonToJournal(payload, resp))
      {
         syncedCount += countInBatch;
         PrintFormat("✅ [TradeJournalSync] Batch %d/%d synced (%d deals)", b + 1, totalBatches, countInBatch);
      }
      else
      {
         PrintFormat("❌ [TradeJournalSync] Failed at batch %d/%d", b + 1, totalBatches);
         break;
      }
      Sleep(50);
   }

   g_total_deals_synced = syncedCount;
   g_last_synced_time = TimeCurrent();
   g_sync_status = "🟢 Connected (Realtime Active)";
   g_status_color = clrLime;
   UpdateDashboard();

   PrintFormat("🎉 [TradeJournalSync] History sync complete! Total: %d deals", syncedCount);
   g_last_history_total = totalDeals;
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

   SyncHistoryBatched(fromTime, TimeCurrent() + 86400);
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
   int height = 210;

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
   CreateLabel("Title", "⚡ TRADE JOURNAL SYNC (PRO)", x + 15, y + 12, clrWhite, 10, true);

   // Labels
   CreateLabel("Account", "Account: -", x + 15, y + 36, clrSilver, 9);
   CreateLabel("Balance", "Balance: -", x + 15, y + 56, clrSilver, 9);
   CreateLabel("Positions", "Open Positions: -", x + 15, y + 76, clrSilver, 9);
   CreateLabel("GmtOffset", "Server Time: -", x + 15, y + 96, clrSilver, 8);
   CreateLabel("Visuals", "Visuals: -", x + 15, y + 114, clrSilver, 8);
   CreateLabel("Status", "Status: Initializing...", x + 15, y + 132, clrYellow, 9);
   CreateLabel("Synced", "History Deals Synced: 0", x + 15, y + 152, clrSilver, 9);
   CreateLabel("LastTime", "Last Sync: -", x + 15, y + 170, clrGray, 8);

   // Status Visual Banner (No manual button needed - 100% automatic)
   CreateLabel("AutoBadge", "● AUTO-SYNC: ACTIVE (Continuous Live Sync)", x + 15, y + 188, C'52,211,153', 8, true);

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

   long login     = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker  = AccountInfoString(ACCOUNT_COMPANY);
   string curr    = AccountInfoString(ACCOUNT_CURRENCY);
   double bal     = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq      = AccountInfoDouble(ACCOUNT_EQUITY);
   double floating= eq - bal;
   int gmtOffHours= GetBrokerGmtOffset() / 3600;

   long tradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string mode = (tradeMode == ACCOUNT_TRADE_MODE_REAL ? "REAL" : (tradeMode == ACCOUNT_TRADE_MODE_DEMO ? "DEMO" : "PROP"));
   long lev = AccountInfoInteger(ACCOUNT_LEVERAGE);

   ObjectSetString(0, GUI_PREFIX + "Account", OBJPROP_TEXT, 
      StringFormat("[%s 1:%I64d] #%I64d (%s)", mode, lev, login, broker));
   
   ObjectSetString(0, GUI_PREFIX + "Balance", OBJPROP_TEXT, 
      StringFormat("Balance / Eq: %.2f / %.2f %s (%+.2f)", bal, eq, curr, floating));

   ObjectSetString(0, GUI_PREFIX + "Positions", OBJPROP_TEXT, 
      StringFormat("Open Positions: %d active", PositionsTotal()));

   ObjectSetString(0, GUI_PREFIX + "GmtOffset", OBJPROP_TEXT, 
      StringFormat("Server Offset: GMT%+d (UTC active)", gmtOffHours));

   ObjectSetString(0, GUI_PREFIX + "Visuals", OBJPROP_TEXT, 
      StringFormat("MAE/MFE: Active | Screenshot: %s", (InpAutoScreenshot ? "ON" : "OFF")));

   ObjectSetString(0, GUI_PREFIX + "Status", OBJPROP_TEXT, "Status: " + g_sync_status);
   ObjectSetInteger(0, GUI_PREFIX + "Status", OBJPROP_COLOR, g_status_color);

   ObjectSetString(0, GUI_PREFIX + "Synced", OBJPROP_TEXT, 
      StringFormat("History Deals Synced: %d", g_total_deals_synced));

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
   Print("🚀 [TradeJournalSync] Initializing Institutional MT5 Sync EA (Pro)...");
   PrintFormat("🔗 Webhook URL: %s", InpApiUrl);
   PrintFormat("💼 Account: %I64d (%s)", AccountInfoInteger(ACCOUNT_LOGIN), AccountInfoString(ACCOUNT_COMPANY));
   PrintFormat("🌍 Broker GMT Offset: %+d hours", GetBrokerGmtOffset() / 3600);

   CreateDashboard();
   EventSetTimer(InpHeartbeatSec);

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
   Print("🛑 [TradeJournalSync] EA Deinitialized cleanly.");
}

//+------------------------------------------------------------------+
//| Real-time Trade Transaction Handler                              |
//+------------------------------------------------------------------+
void OnTradeTransaction(
   const MqlTradeTransaction& trans,
   const MqlTradeRequest& request,
   const MqlTradeResult& result
)
{
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      ulong dealTicket = trans.deal;
      if(dealTicket > 0 && HistoryDealSelect(dealTicket))
      {
         string dealSymbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);

         // Capture chart screenshot on entry or exit
         string screenshotBase64 = "";
         if(InpAutoScreenshot)
         {
            screenshotBase64 = CaptureChartScreenshotBase64(dealTicket, dealSymbol);
         }

         string dealJson = BuildDealJson(dealTicket, screenshotBase64);
         string payload = "{";
         if(StringLen(InpApiKey) > 0)
            payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
         payload += BuildAccountJson();
         
         if(StringLen(dealJson) > 0)
         {
            payload += ",\"executions\":[" + dealJson + "]}";
            string resp;
            if(SendJsonToJournal(payload, resp))
            {
               g_total_deals_synced++;
               PrintFormat("⚡ [TradeJournalSync] Realtime deal synced: #%I64d (%s)", 
                  dealTicket, HistoryDealGetString(dealTicket, DEAL_SYMBOL));
            }
         }
         else
         {
            payload += ",\"executions\":[]}";
            string resp;
            SendJsonToJournal(payload, resp);
         }
      }
      g_last_synced_time = TimeCurrent();
      UpdateDashboard();
   }
}

//+------------------------------------------------------------------+
//| Periodic Heartbeat & Continuous History Resync                   |
//+------------------------------------------------------------------+
void OnTimer()
{
   datetime fromTime = 0;
   if(InpSyncScope == SYNC_ALL_HISTORY)
      fromTime = 0;
   else if(InpSyncScope == SYNC_PAST_DAYS)
      fromTime = TimeCurrent() - (InpSyncDays * 86400);
   else if(InpSyncScope == SYNC_FROM_DATE)
      fromTime = InpSyncStartDate;

   string payload = "{";
   if(StringLen(InpApiKey) > 0)
      payload += "\"apiKey\":\"" + EscapeJson(InpApiKey) + "\",";
   payload += BuildAccountJson(fromTime, TimeCurrent() + 86400);

   string executionsJson = "";
   int newDealsCount = 0;

   if(HistorySelect(fromTime, TimeCurrent() + 86400))
   {
      int total = HistoryDealsTotal();
      if(total != g_last_history_total)
      {
         int scanLimit = MathMin(total, 50);
         int startIdx = MathMax(0, total - scanLimit);

         for(int i = startIdx; i < total; i++)
         {
            ulong t = HistoryDealGetTicket(i);
            if(t == 0) continue;
            string dealJson = BuildDealJson(t);
            if(StringLen(dealJson) > 0)
            {
               if(newDealsCount > 0) executionsJson += ",";
               executionsJson += dealJson;
               newDealsCount++;
            }
         }
         g_last_history_total = total;
      }
   }

   payload += ",\"executions\":[" + executionsJson + "]}";

   string resp;
   if(SendJsonToJournal(payload, resp))
   {
      g_last_synced_time = TimeCurrent();
      if(newDealsCount > 0)
         g_total_deals_synced += newDealsCount;
   }
   UpdateDashboard();
}
//+------------------------------------------------------------------+
