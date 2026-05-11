import { useMemo, useState, type MouseEvent } from "react";
import type { FlowEdge, FlowNode, NodeKind } from "../../shared/workflow";

type WorkflowCanvasProps = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  theme: "dark" | "light";
  onSelectNode: (nodeId: string) => void;
  onUpdateNodePosition: (nodeId: string, position: FlowNode["position"]) => void;
};

type DragState = {
  nodeId: string;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
} | null;

const NODE_WIDTH = 220;
const NODE_HEIGHT = 148;

const kindClassName: Record<"dark" | "light", Record<NodeKind, string>> = {
  dark: {
    start:
      "border-emerald-300/25 bg-[linear-gradient(180deg,rgba(16,46,34,0.92),rgba(8,24,18,0.94))] text-emerald-50",
    llm:
      "border-sky-300/25 bg-[linear-gradient(180deg,rgba(18,38,51,0.92),rgba(8,19,27,0.94))] text-sky-50",
    review:
      "border-amber-300/25 bg-[linear-gradient(180deg,rgba(53,35,12,0.92),rgba(31,20,7,0.94))] text-amber-50",
    end:
      "border-rose-300/25 bg-[linear-gradient(180deg,rgba(52,21,29,0.92),rgba(28,10,16,0.94))] text-rose-50",
  },
  light: {
    start:
      "border-emerald-500/25 bg-[linear-gradient(180deg,rgba(230,247,238,0.98),rgba(214,239,226,0.95))] text-emerald-950",
    llm:
      "border-sky-500/25 bg-[linear-gradient(180deg,rgba(233,244,251,0.98),rgba(217,235,247,0.95))] text-sky-950",
    review:
      "border-amber-500/25 bg-[linear-gradient(180deg,rgba(252,243,224,0.98),rgba(246,231,198,0.95))] text-amber-950",
    end:
      "border-rose-500/25 bg-[linear-gradient(180deg,rgba(251,236,239,0.98),rgba(245,220,226,0.95))] text-rose-950",
  },
};

const kindTextMap: Record<NodeKind, string> = {
  start: "开始",
  llm: "模型",
  review: "审核",
  end: "结束",
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const WorkflowCanvas = ({
  nodes,
  edges,
  selectedNodeId,
  theme,
  onSelectNode,
  onUpdateNodePosition,
}: WorkflowCanvasProps) => {
  const [dragState, setDragState] = useState<DragState>(null);

  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const edgeViews = useMemo(() => {
    return edges
      .map((edge) => {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);

        if (!source || !target) {
          return null;
        }

        const startX = source.position.x + NODE_WIDTH;
        const startY = source.position.y + NODE_HEIGHT / 2;
        const endX = target.position.x;
        const endY = target.position.y + NODE_HEIGHT / 2;
        const offset = Math.max(60, Math.abs(endX - startX) / 2);
        const path = `M ${startX} ${startY} C ${startX + offset} ${startY}, ${endX - offset} ${endY}, ${endX} ${endY}`;
        const labelX = (startX + endX) / 2;
        const labelY = (startY + endY) / 2 - 12;

        return {
          ...edge,
          path,
          labelX,
          labelY,
        };
      })
      .filter(Boolean);
  }, [edges, nodeMap]);

  const handleNodeMouseDown = (event: MouseEvent<HTMLButtonElement>, node: FlowNode) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectNode(node.id);
    setDragState({
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: node.position.x,
      originY: node.position.y,
    });
  };

  const handleCanvasMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!dragState) {
      return;
    }

    const nextX = clamp(
      dragState.originX + (event.clientX - dragState.startClientX),
      24,
      1180,
    );
    const nextY = clamp(
      dragState.originY + (event.clientY - dragState.startClientY),
      24,
      700,
    );

    onUpdateNodePosition(dragState.nodeId, {
      x: nextX,
      y: nextY,
    });
  };

  const stopDragging = () => {
    if (dragState) {
      setDragState(null);
    }
  };

  return (
    <div
      className={`relative h-[760px] overflow-hidden rounded-[28px] border ${
        theme === "dark"
          ? "border-white/8 bg-[linear-gradient(135deg,rgba(9,11,14,0.96),rgba(19,20,24,0.92))]"
          : "border-black/8 bg-[linear-gradient(135deg,rgba(250,247,241,0.98),rgba(241,236,228,0.96))]"
      }`}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={stopDragging}
      onMouseLeave={stopDragging}
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-[size:34px_34px] ${
          theme === "dark"
            ? "bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] opacity-35"
            : "bg-[linear-gradient(rgba(0,0,0,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.05)_1px,transparent_1px)] opacity-30"
        }`}
      />
      <div
        className={`pointer-events-none absolute inset-0 ${
          theme === "dark"
            ? "bg-[radial-gradient(circle_at_top,_rgba(216,163,93,0.12),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(124,159,182,0.10),_transparent_32%)]"
            : "bg-[radial-gradient(circle_at_top,_rgba(216,163,93,0.10),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(124,159,182,0.08),_transparent_30%)]"
        }`}
      />

      <div
        className={`absolute left-4 top-4 z-20 rounded-full px-4 py-2 text-xs uppercase tracking-[0.24em] ${
          theme === "dark"
            ? "border border-white/10 bg-black/25 text-[#d4c8b9]"
            : "border border-black/10 bg-white/70 text-[#6c5943]"
        }`}
      >
        Flow Stage
      </div>

      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <marker
            id="workflow-arrow"
            markerWidth="12"
            markerHeight="12"
            refX="10"
            refY="6"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path
              d="M0,0 L12,6 L0,12 z"
              fill={theme === "dark" ? "rgba(216, 163, 93, 0.85)" : "rgba(166, 112, 39, 0.8)"}
            />
          </marker>
        </defs>
        {edgeViews.map((edge) => {
          if (!edge) {
            return null;
          }

          return (
            <g key={edge.id}>
              <path
                d={edge.path}
                fill="none"
                stroke={theme === "dark" ? "rgba(216, 163, 93, 0.8)" : "rgba(166, 112, 39, 0.72)"}
                strokeWidth="2.5"
                markerEnd="url(#workflow-arrow)"
              />
              {edge.label ? (
                <>
                  <rect
                    x={edge.labelX - 32}
                    y={edge.labelY - 11}
                    width="64"
                    height="22"
                    rx="11"
                    fill={theme === "dark" ? "rgba(11, 12, 15, 0.94)" : "rgba(255,255,255,0.94)"}
                    stroke={theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}
                  />
                  <text
                    x={edge.labelX}
                    y={edge.labelY + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fill={theme === "dark" ? "rgba(245, 233, 214, 0.92)" : "rgba(91, 66, 39, 0.92)"}
                  >
                    {edge.label}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>

      {nodes.map((node) => {
        const isSelected = node.id === selectedNodeId;

        return (
          <button
            key={node.id}
            type="button"
            onMouseDown={(event) => handleNodeMouseDown(event, node)}
            onClick={() => onSelectNode(node.id)}
            className={`absolute flex w-[220px] flex-col overflow-hidden rounded-[26px] border p-4 text-left shadow-[0_20px_40px_rgba(0,0,0,0.32)] transition ${kindClassName[theme][node.kind]} ${
              isSelected
                ? `ring-2 ${theme === "dark" ? "ring-[#d8a35d]/55" : "ring-[#a67027]/45"}`
                : "hover:-translate-y-1 hover:border-white/20 hover:shadow-[0_24px_46px_rgba(0,0,0,0.36)]"
            }`}
            style={{
              left: `${node.position.x}px`,
              top: `${node.position.y}px`,
              height: `${NODE_HEIGHT}px`,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em] ${
                  theme === "dark"
                    ? "border border-white/10 bg-black/20 text-white/90"
                    : "border border-black/10 bg-white/65 text-black/75"
                }`}
              >
                {kindTextMap[node.kind]}
              </span>
              <span className={theme === "dark" ? "text-xs text-white/55" : "text-xs text-black/45"}>
                {node.id}
              </span>
            </div>
            <div
              className={`mt-4 line-clamp-1 text-base font-semibold tracking-[0.02em] ${
                theme === "dark" ? "text-white" : "text-black/85"
              }`}
            >
              {node.label}
            </div>
            <div
              className={`mt-2 overflow-hidden text-sm leading-6 ${
                theme === "dark" ? "text-white/72" : "text-black/66"
              }`}
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {node.description}
            </div>
          </button>
        );
      })}
    </div>
  );
};

