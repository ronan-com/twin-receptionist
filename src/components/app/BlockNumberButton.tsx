import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { automationsQueryKey, getAutomations, saveAutomations } from "@/lib/api/automations";
import { fmtPhone } from "@/lib/app/format";

// "Block this number" on a call: adds the caller to the receptionist's block list
// (Automations > Spam and robocalls). Later calls from it are hung up on at once.
export function BlockNumberButton({ businessId, number }: { businessId: string; number: string }) {
  const qc = useQueryClient();
  const block = useMutation({
    mutationFn: async () => {
      const current = (await getAutomations(businessId)).settings.spam.blockList;
      return saveAutomations(businessId, { spam: { blockList: [...new Set([...current, number])] } });
    },
    onSuccess: (state) => {
      qc.setQueryData(automationsQueryKey(businessId), state);
      toast.success(`${fmtPhone(number)} blocked`, { description: "The receptionist will hang up on this number. You can unblock it under Automations." });
    },
    onError: (e: Error) => toast.error("Couldn't block that number", { description: e.message }),
  });
  return (
    <Button type="button" variant="outline" size="sm" className="h-9 w-full text-[13px]" data-action="block-number" disabled={block.isPending} onClick={() => block.mutate()}>
      {block.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Ban className="mr-2 h-3.5 w-3.5" />} Block this number
    </Button>
  );
}
