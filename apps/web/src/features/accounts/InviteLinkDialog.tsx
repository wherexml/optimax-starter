import { FormDialog } from "@/components/ui/FormDialog";
import { CopyableInput } from "@/components/ui/input-group";
import type { AccountInviteLink } from "@/console-client";

export type InviteLinkResult = AccountInviteLink & { name: string; username: string };

function formatExpiry(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

/**
 * Shows a freshly generated one-time activation link. The raw token exists only in this
 * response (the server stores its digest), so the link cannot be shown again after closing.
 */
export function InviteLinkDialog({
  invite,
  close,
}: {
  invite: InviteLinkResult;
  close: () => void;
}) {
  const url = `${location.origin}${invite.invitePath}`;
  return (
    <FormDialog
      open
      title="一次性激活链接"
      description={`请将链接发送给 ${invite.name}（${invite.username}），对方设置密码后账户即被启用。`}
      size="md"
      submitText="我已复制"
      submitVariant="default"
      onSubmit={close}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <div className="flex flex-col gap-3">
        <CopyableInput
          aria-label="激活链接"
          value={url}
          copyLabel="复制激活链接"
          className="font-mono text-xs"
        />
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>该链接仅显示这一次，关闭后无法再次查看；如遗失请重新生成。</li>
          <li>有效期 72 小时，至 {formatExpiry(invite.expiresAt)}；仅可使用一次。</li>
          <li>重新生成会使此前未使用的链接立即失效。</li>
        </ul>
      </div>
    </FormDialog>
  );
}
