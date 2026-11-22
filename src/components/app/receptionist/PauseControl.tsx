import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/forms";
import { DEFAULT_PAUSE_MESSAGE, pauseReceptionist, type ReceptionistRow, type ReceptionistSaved } from "./model";

// Pause / resume the receptionist (POST /api/manage/<id>/receptionist/pause). Only shown
// to people who can edit. Success is shown only once the server has saved it and (for a
// live receptionist) the phone provider has taken the new greeting and script.

export function PauseControl({
  businessId,
  agent,
  blockedReason,
  onDone,
}: {
  businessId: string;
  agent: ReceptionistRow;
  /** Why pausing can't be changed right now (unsaved edits), or null. */
  blockedReason: string | null;
  onDone: (res: ReceptionistSaved) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(agent.paused_message || DEFAULT_PAUSE_MESSAGE);
  const pausedByBusiness = agent.paused_by === "business";

  const mutate = useMutation({
    mutationFn: (paused: boolean) => pauseReceptionist(businessId, paused ? { paused, message: message.trim() } : { paused }),
    onSuccess: async (res, paused) => {
      setOpen(false);
      const where = res.applied ? "Callers hear the change from the next call." : res.demo ? "This is a test receptionist, so nothing is sent to the phone provider." : undefined;
      toast.success(paused ? "Receptionist paused" : "Receptionist resumed", { description: where });
      if (res.warning) toast.warning(res.warning);
      await onDone(res);
    },
    onError: (e: Error, paused) => toast.error(paused ? "Couldn't pause. Your receptionist is still answering as before." : "Couldn't resume. It's still paused.", { description: e.message }),
  });

  if (agent.paused_by === "agency") return null;

  if (pausedByBusiness) {
    return (
      <Button size="sm" onClick={() => mutate.mutate(false)} disabled={mutate.isPending || !!blockedReason} title={blockedReason ?? undefined} data-action="resume">
        {mutate.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
        Resume receptionist
      </Button>
    );
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!!blockedReason} title={blockedReason ?? undefined} data-action="pause">
        <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause receptionist
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg rounded-[6px]">
          <DialogHeader>
            <DialogTitle className="text-[16px]">Pause your receptionist?</DialogTitle>
            <DialogDescription className="text-[12.5px]">
              It keeps answering, but only to play the message below and take the caller's name, number and a short note. It won't book, check availability, put calls through or answer detailed questions until you resume.
            </DialogDescription>
          </DialogHeader>
          <Field label="What callers hear" htmlFor="pause-message" hint="Said instead of your greeting while paused.">
            <Textarea id="pause-message" rows={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => mutate.mutate(true)} disabled={mutate.isPending} data-action="confirm-pause">
              {mutate.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
              Pause receptionist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
