import { useStyle } from './style';

type ProgressIndicatorProps = {
  value: number;
  size?: number;
};

const CX = 50;
const CY = 50;
const R_INNER = 36; // track and sector
const R_RING = 44; // outer ring (gap between inner edge and R_INNER is ~5 units)

const sectorPath = (pct: number): string => {
  const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2;
  const x = CX + R_INNER * Math.cos(angle);
  const y = CY + R_INNER * Math.sin(angle);
  const largeArc = pct > 50 ? 1 : 0;
  return `M ${CX} ${CY} L ${CX} ${CY - R_INNER} A ${R_INNER} ${R_INNER} 0 ${largeArc} 1 ${x} ${y} Z`;
};

export const ProgressIndicator = ({ value, size = 40 }: ProgressIndicatorProps) => {
  const style = useStyle();
  const clamped = Math.min(100, Math.max(0, value * 100));

  return (
    <div className={style.root}>
      {clamped > 0 && clamped < 100 && (
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <circle cx={CX} cy={CY} r={R_INNER} className={style.track} />
          <path d={sectorPath(clamped)} className={style.sector} />
          <circle cx={CX} cy={CY} r={R_RING} className={style.ring} />
        </svg>
      )}
      <span className={style.label}>
        {clamped === 0 ? 'Not started' : clamped === 100 ? 'Completed' : `${Math.round(clamped)}%`}
      </span>
    </div>
  );
};
