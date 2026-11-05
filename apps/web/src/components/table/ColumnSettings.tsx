import { Settings2, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
type ColumnConfig = { visible: boolean; width: number };

interface SortableColumnItemProps {
  columnKey: string;
  visible: boolean;
  label: string;
  onToggle: () => void;
}

function SortableColumnItem({
  columnKey,
  visible,
  label,
  onToggle,
}: SortableColumnItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: columnKey,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="flex items-center gap-2 p-2 hover:bg-accent rounded"
    >
      <div {...listeners} className="cursor-move touch-none">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>
      <Checkbox
        aria-label={label}
        checked={visible}
        onCheckedChange={onToggle}
      />
      <label className="text-sm flex-1 cursor-pointer" onClick={onToggle}>
        {label}
      </label>
    </div>
  );
}

interface ColumnSettingsProps {
  columns: Record<string, ColumnConfig>;
  columnOrder: string[];
  columnLabels: Record<string, string>;
  onColumnsChange: (
    columns: Record<string, ColumnConfig>,
    order: string[],
  ) => void;
  translations?: {
    columnSettings?: string;
    dragToReorder?: string;
  };
}

export function ColumnSettings({
  columns,
  columnOrder,
  columnLabels,
  onColumnsChange,
  translations = {},
}: ColumnSettingsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const toggleColumn = (columnKey: string) => {
    const newColumns = {
      ...columns,
      [columnKey]: {
        ...columns[columnKey],
        visible: !columns[columnKey].visible,
      },
    };
    onColumnsChange(newColumns, columnOrder);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // 禁止拖拽 actions 列（操作列永远在最右边）
    if (active.id === "actions" || over?.id === "actions") {
      return;
    }

    if (over && active.id !== over.id) {
      const oldIndex = columnOrder.indexOf(active.id as string);
      const newIndex = columnOrder.indexOf(over.id as string);
      const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
      onColumnsChange(columns, newOrder);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Settings2 className="h-4 w-4" />
          {translations.columnSettings || "Column Settings"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[500px] overflow-auto">
        <div className="space-y-4">
          <h4 className="font-semibold text-sm">
            {translations.dragToReorder || "Drag to Reorder"}
          </h4>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={columnOrder.filter((col) => col !== "actions")}
              strategy={verticalListSortingStrategy}
            >
              {columnOrder
                .filter((col) => col !== "actions")
                .map((columnKey) => (
                  <SortableColumnItem
                    key={columnKey}
                    columnKey={columnKey}
                    visible={columns[columnKey]?.visible ?? true}
                    label={columnLabels[columnKey] || columnKey}
                    onToggle={() => toggleColumn(columnKey)}
                  />
                ))}
            </SortableContext>
          </DndContext>
        </div>
      </PopoverContent>
    </Popover>
  );
}
