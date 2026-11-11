// The constant "1" (a triangle, RAM notation): its arrows are latent means and
// intercepts (lavaan's mean structure). One per model; drag it like a construct,
// drag from its handle to a construct to add a mean arrow.

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { CONSTANT_R } from '../geometry';
import type { Tool } from '../store';

export type ConstantNodeData = { tool: Tool; hasError: boolean };
export type ConstantFlowNode = Node<ConstantNodeData, 'constant'>;

function ConstantNodeImpl({ data, selected }: NodeProps<ConstantFlowNode>) {
  const w = CONSTANT_R * 2 + 8,
    h = CONSTANT_R * 2 + 4;
  const cx = w / 2,
    cy = h / 2;
  return (
    <div
      className={`cnode constant${selected ? ' selected' : ''}${data.hasError ? ' error' : ''}`}
      style={{ width: w, height: h }}
      title="The constant (1): intercepts and means (lavaan meanstructure). Drag from its handle to a construct for its latent mean."
    >
      <svg width={w} height={h} aria-label="Constant">
        <path
          d={`M ${cx} ${cy - CONSTANT_R} L ${cx + CONSTANT_R * 0.95} ${cy + CONSTANT_R * 0.7} L ${cx - CONSTANT_R * 0.95} ${cy + CONSTANT_R * 0.7} Z`}
          className="constant-shape"
        />
        <text x={cx} y={cy + CONSTANT_R * 0.35} textAnchor="middle" className="constant-label">
          1
        </text>
      </svg>
      <Handle
        type="source"
        id="s"
        position={Position.Right}
        className="handle-dot"
        title="Drag to a construct: its mean (or an observed variable's intercept)"
        style={{
          left: cx + CONSTANT_R * 0.8,
          top: cy,
          right: 'auto',
          transform: 'translate(-50%, -50%)',
          display: data.tool === 'connect' ? 'none' : undefined,
        }}
      />
      <Handle
        type="source"
        id="sc"
        position={Position.Right}
        className="handle-cover"
        style={{
          left: 0,
          top: 0,
          width: w,
          height: h,
          pointerEvents: data.tool === 'connect' ? 'all' : 'none',
          cursor: 'crosshair',
        }}
      />
    </div>
  );
}

export const ConstantNode = memo(ConstantNodeImpl);
