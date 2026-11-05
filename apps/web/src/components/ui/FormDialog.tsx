import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  onSubmit?: () => void;
  onCancel?: () => void;
  submitText?: string;
  cancelText?: string;
  submitDisabled?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  loading?: boolean;
  formId?: string;
  onCloseAutoFocus?: React.ComponentProps<
    typeof DialogContent
  >["onCloseAutoFocus"];
}

/**
 * FormDialog - 表单类弹窗组件
 *
 * 符合 spec.md 7.6 弹窗整体布局规范
 * - 默认 size="lg" (max-w-3xl max-h-[90vh])
 * - 内部间距 space-y-6 (24px)
 * - Footer 按钮间距 gap-2 (8px)
 * - 取消在左，确认在右
 *
 * @example
 * ```tsx
 * <FormDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   title="创建任务"
 *   size="lg"
 *   onSubmit={handleSubmit}
 *   submitDisabled={!isValid}
 *   loading={isSubmitting}
 * >
 *   <div className="space-y-4">
 *     <Label>任务名称</Label>
 *     <Input value={name} onChange={setName} />
 *   </div>
 * </FormDialog>
 * ```
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  onCancel,
  submitText = "确认",
  cancelText = "取消",
  submitDisabled = false,
  size = "lg", // 默认 lg (符合 spec.md)
  loading = false,
  formId,
  onCloseAutoFocus,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size={size}
        onCloseAutoFocus={onCloseAutoFocus}
        {...(!description ? { "aria-describedby": undefined } : {})}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {/* 遵循 spec.md 7.6.3: space-y-6 */}
        <div className="space-y-6">{children}</div>

        {/* 统一 Footer 样式：取消在左，确认在右，gap-2 */}
        <DialogFooter className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={onCancel || (() => onOpenChange(false))}
            disabled={loading}
          >
            {cancelText}
          </Button>
          {(onSubmit || formId) && (
            <Button
              type={formId ? "submit" : "button"}
              form={formId}
              onClick={onSubmit}
              disabled={submitDisabled || loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitText}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
