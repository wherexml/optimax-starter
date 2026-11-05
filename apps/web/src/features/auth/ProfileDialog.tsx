import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormDialog } from "@/components/ui/FormDialog";
import {
  Form,
  FormField,
  FormItem,
  FormControl,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { request } from "@/console-client";

const schema = z.object({
  name: z.string().trim().min(1, "请输入显示名称").max(80, "最多 80 个字符"),
});
type Values = z.infer<typeof schema>;

export function ProfileDialog({
  name,
  trigger,
  close,
}: {
  name: string;
  trigger: HTMLElement | null;
  close: () => void;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name },
  });
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: (values: Values) =>
      request("/me", "PATCH", { name: values.name.trim() }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      close();
    },
    onError: (error) =>
      form.setError("name", { message: error.message }, { shouldFocus: true }),
  });
  const submit = form.handleSubmit((values) =>
    values.name.trim() === name ? close() : save.mutate(values),
  );
  return (
    <FormDialog
      open
      title="显示名称"
      size="sm"
      submitText="保存"
      loading={save.isPending}
      formId="profile-name"
      onCloseAutoFocus={(e) => {
        if (trigger?.isConnected) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <Form {...form}>
        <form noValidate id="profile-name" onSubmit={submit}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>姓名</FormLabel>
                <FormControl>
                  <Input {...field} autoFocus autoComplete="name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </FormDialog>
  );
}
