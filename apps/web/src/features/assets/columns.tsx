import { type ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { type Asset } from "@/console-client";

// Column ids equal ASSET_SORT_FIELDS so server sorting can use header.column.id directly.
export const assetColumns: ColumnDef<Asset>[] = [
  {
    id: "id",
    accessorKey: "id",
    header: "编号",
    enableSorting: true,
    cell: (c) => (
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        AS-{String(c.getValue()).padStart(3, "0")}
      </span>
    ),
  },
  {
    id: "name",
    accessorKey: "name",
    header: "资产名称",
    enableSorting: true,
    cell: (c) => <span className="font-medium">{String(c.getValue())}</span>,
  },
  { id: "domain", accessorKey: "domain", header: "业务域", enableSorting: true },
  { id: "owner", accessorKey: "owner", header: "责任团队", enableSorting: true },
  {
    id: "stage",
    accessorKey: "stage",
    header: "登记状态",
    enableSorting: true,
    cell: (c) => (
      <Badge variant={c.getValue() === "已登记" ? "brand" : "warning"}>
        {String(c.getValue())}
      </Badge>
    ),
  },
];
