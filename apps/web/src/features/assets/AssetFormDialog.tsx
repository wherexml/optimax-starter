import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  ASSET_STAGES,
  assetInputSchema,
  type Asset,
  type AssetInput,
} from "@optimax-starter/api";
import { FormDialog } from "@/components/ui/FormDialog";
import {
  FieldCharCount,
  FieldLabelRow,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ClearableInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { request } from "@/console-client";

export function AssetFormDialog({
  asset,
  close,
  trigger,
}: {
  asset?: Asset;
  close: (message?: string, created?: Asset) => void;
  trigger: HTMLElement | null;
}) {
  const editing = Boolean(asset);
  const form = useForm<AssetInput>({
    resolver: zodResolver(assetInputSchema),
    defaultValues: {
      name: asset?.name ?? "",
      domain: asset?.domain ?? "",
      owner: asset?.owner ?? "",
      stage:
        asset?.stage === "待复核" || asset?.stage === "已登记"
          ? asset.stage
          : "待复核",
    },
  });
  const { isDirty } = form.formState;
  const [confirming, setConfirming] = useState(false);
  const nameValue = form.watch("name");

  const keepEditing = () => {
    setConfirming(false);
    form.setFocus("name");
  };
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: (values: AssetInput) =>
      editing
        ? request<Asset>(`/assets/${asset!.id}`, "PATCH", values)
        : request<Asset>("/assets", "POST", values),
    onSuccess: async (savedData, values) => {
      await cache.invalidateQueries({ queryKey: ["assets"] });
      close(
        editing
          ? `已更新资产 ${values.name.trim()}`
          : `已登记资产 ${values.name.trim()}`,
        editing ? undefined : savedData,
      );
    },
    onError: (error) =>
      form.setError(
        error.message === "资产名称已存在" ? "name" : "root",
        { message: error.message },
        { shouldFocus: true },
      ),
  });
  const submit = form.handleSubmit((values) => save.mutate(values));
  const rootError = form.formState.errors.root?.message;

  return (
    <FormDialog
      open
      title={editing ? "编辑资产" : "新增资产"}
      size="md"
      submitText={editing ? "保存修改" : "保存资产"}
      loading={save.isPending}
      formId="asset-form"
      unsaved={
        confirming
          ? {
              onKeepEditing: keepEditing,
              onDiscard: () => close(),
              discardText: "放弃改动",
            }
          : null
      }
      onCloseAutoFocus={(e) => {
        if (trigger?.isConnected) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (open || save.isPending) return;
        if (confirming) keepEditing();
        else if (isDirty) setConfirming(true);
        else close();
      }}
    >
      <Form {...form}>
        <form
          noValidate
          id="asset-form"
          onSubmit={submit}
          className="grid gap-4 sm:grid-cols-2"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FieldLabelRow>
                  <FormLabel required>资产名称</FormLabel>
                  <FieldCharCount current={nameValue.length} max={80} />
                </FieldLabelRow>
                <FormControl>
                  <ClearableInput
                    {...field}
                    autoComplete="off"
                    autoFocus
                    maxLength={80}
                    placeholder="例如：采购门户"
                    onClear={() => form.setValue("name", "", { shouldDirty: true })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="domain"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>业务域</FormLabel>
                <FormControl>
                  <ClearableInput
                    {...field}
                    autoComplete="off"
                    maxLength={40}
                    placeholder="例如：采购、履约、运营"
                    onClear={() => form.setValue("domain", "", { shouldDirty: true })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="owner"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>责任团队</FormLabel>
                <FormControl>
                  <ClearableInput
                    {...field}
                    autoComplete="off"
                    maxLength={60}
                    placeholder="例如：平台组"
                    onClear={() => form.setValue("owner", "", { shouldDirty: true })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="stage"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>登记状态</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger aria-label="登记状态">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ASSET_STAGES.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        {stage}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {rootError && (
            <p
              role="alert"
              className="m-0 text-xs font-medium leading-[18px] text-destructive sm:col-span-2"
            >
              {rootError}
            </p>
          )}
        </form>
      </Form>
    </FormDialog>
  );
}
