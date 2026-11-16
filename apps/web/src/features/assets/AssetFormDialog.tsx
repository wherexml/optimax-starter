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
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
  close: (message?: string) => void;
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
    onSuccess: async (_data, values) => {
      await cache.invalidateQueries({ queryKey: ["assets"] });
      close(editing ? `已更新资产 ${values.name.trim()}` : `已登记资产 ${values.name.trim()}`);
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
                <FormLabel>资产名称</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    autoFocus
                    placeholder="例如：采购门户"
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
                <FormLabel>业务域</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    placeholder="例如：采购、履约、运营"
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
                <FormLabel>责任团队</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    placeholder="例如：平台组"
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
                <FormLabel>登记状态</FormLabel>
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
            <p role="alert" className="m-0 text-sm text-destructive sm:col-span-2">
              {rootError}
            </p>
          )}
          {confirming && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm sm:col-span-2"
            >
              <span>有未保存的改动，确定放弃吗？</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={keepEditing}>
                  继续编辑
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => close()}
                >
                  放弃改动
                </Button>
              </div>
            </div>
          )}
        </form>
      </Form>
    </FormDialog>
  );
}
