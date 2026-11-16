import { type ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { type Asset } from "@/console-client";

export const assetColumns: ColumnDef<Asset>[] = [
  {
    accessorKey: "id",
    header: "编号",
    cell: (c) => (
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        AS-{String(c.getValue()).padStart(3, "0")}
      </span>
    ),
  },
  {
    accessorKey: "name",
    header: "资产名称",
    cell: (c) => <span className="font-medium">{String(c.getValue())}</span>,
  },
  { accessorKey: "domain", header: "业务域" },
  { accessorKey: "owner", header: "责任团队" },
  {
    accessorKey: "stage",
    header: "登记状态",
    cell: (c) => (
      <Badge variant={c.getValue() === "已登记" ? "brand" : "warning"}>
        {String(c.getValue())}
      </Badge>
    ),
  },
];
