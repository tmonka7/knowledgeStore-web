/** Decorative neural-network mark shown at the foot of the sidebar. */
export default function NetworkArt() {
  const nodes = [
    [40, 12], [14, 30], [66, 30], [8, 58], [72, 58], [40, 44], [26, 72], [54, 72], [40, 88],
  ];
  const links = [
    [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [1, 5], [2, 5], [3, 6], [4, 7],
    [5, 6], [5, 7], [6, 8], [7, 8], [3, 5], [4, 5],
  ];

  return (
    <svg className="vision-net-art" viewBox="0 0 80 100" fill="none" aria-hidden="true">
      <g className="net-link">
        {links.map(([from, to]) => (
          <line
            key={`${from}-${to}`}
            x1={nodes[from][0]}
            y1={nodes[from][1]}
            x2={nodes[to][0]}
            y2={nodes[to][1]}
          />
        ))}
      </g>
      <g className="net-node">
        {nodes.map(([x, y], index) => (
          index === 5 ? null : <circle key={`${x}-${y}`} cx={x} cy={y} r="3" />
        ))}
      </g>
      <circle className="net-core" cx={nodes[5][0]} cy={nodes[5][1]} r="5" />
      <circle className="net-pulse" cx={nodes[5][0]} cy={nodes[5][1]} r="10" />
    </svg>
  );
}
