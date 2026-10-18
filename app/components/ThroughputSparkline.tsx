'use client';

import React from 'react';
import { formatRate } from '@/lib/omada/formatters';

interface ThroughputSparklineProps {
  history: number[]; // Array of bytes/sec rate values
  currentRate: number;
  height?: number;
  width?: number;
}

export default function ThroughputSparkline({
  history,
  currentRate,
  height = 36,
  width = 160,
}: ThroughputSparklineProps) {
  const points = history.length >= 2 ? history : [0, currentRate || 0];
  const maxVal = Math.max(...points, 1024); // Minimum 1 KB/s floor for scaling
  const minVal = 0;

  // Build SVG polyline points
  const stepX = width / (points.length - 1 || 1);
  const coords = points.map((val, idx) => {
    const x = idx * stepX;
    const normalizedY = (val - minVal) / (maxVal - minVal);
    const y = height - normalizedY * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${coords.join(' L ')}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  const peakRate = Math.max(...points);

  return (
    <div className="flex flex-col items-end gap-1 select-none">
      <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400">
        <span className="text-slate-500">Peak:</span>
        <span className="text-cyan-400 font-semibold">{formatRate(peakRate)}</span>
      </div>
      <div className="relative overflow-hidden rounded-lg bg-slate-950/60 p-1 border border-slate-800/80">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="overflow-visible"
        >
          <defs>
            <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#sparklineGrad)" />
          <path
            d={linePath}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Pulsing dot on latest reading (fill-box so origin-center is the dot, not the viewBox) */}
          {coords.length > 0 && (
            <circle
              cx={coords[coords.length - 1].split(',')[0]}
              cy={coords[coords.length - 1].split(',')[1]}
              r="2.5"
              fill="#22d3ee"
              className="animate-ping origin-center [transform-box:fill-box]"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
