"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ManualTradeEntry } from "./manual-trade-entry";
import { Button } from "./ui/button";
import { useApi } from "@/lib/use-api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function AddTradeDialog({ onSaved }: { onSaved: () => void }) {
  const { data: auth } = useApi<{ authenticated: boolean; configured: boolean }>("/api/auth");
  const [open, setOpen] = useState(false);

  // Hide in public view (when password is configured and visitor is not authenticated as admin)
  if (!auth?.authenticated) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-3.5 w-3.5" />
          Add trade
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add trade</DialogTitle>
          <DialogDescription>
            Choose an account and enter your buys and sells. Save an entry alone for an open
            position, or include the exit to record a closed trade.
          </DialogDescription>
        </DialogHeader>
        <ManualTradeEntry
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
