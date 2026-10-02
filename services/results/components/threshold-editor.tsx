'use client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { GRADES, continuousRules, ruleGaps, type Config } from '@/lib/domain';
type Rules = Config['dimensions'][number]['rules'];
export function normalizeRules(rules: Rules): Rules {
  return continuousRules(rules.slice(0, 3).map((r) => r.min));
}
export function ThresholdEditor({
  rules,
  onChange,
  disabled,
  idPrefix,
}: {
  rules: Rules;
  onChange: (rules: Rules) => void;
  disabled: boolean;
  idPrefix: string;
}) {
  const canonical = normalizeRules(rules);
  const changed = JSON.stringify(canonical) !== JSON.stringify(rules);
  function boundary(index: number, value: number) {
    const values = canonical.slice(0, 3).map((r) => r.min);
    values[index] = value;
    onChange(continuousRules(values));
  }
  return (
    <>
      <p className="mini-label">
        上限在上、下限在下。下限均包含；除卓越包含1外，其余上限不包含。修改一个边界，相邻等级同步更新。
      </p>
      {changed && (
        <p className="notice">
          下方显示的就是实际编辑值，不会用建议值替代。未覆盖区间：
          {ruleGaps(rules).join('；') || '无空档，请核对包含边界'}
          。点击“采用连续分档”会明确更新下方编辑值。
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(canonical)}
          >
            采用连续分档
          </Button>
        </p>
      )}
      <div className="rule-grid">
        {rules.map((r, i) => (
          <div className="rule" key={GRADES[i]}>
            <h3>{GRADES[i]}</h3>
            <label htmlFor={`${idPrefix}-upper-${i}`}>
              上限（{r.includeMax ? '含' : '不含'}）
              <Input
                id={`${idPrefix}-upper-${i}`}
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={r.max}
                readOnly={i === 0}
                disabled={disabled}
                onChange={(e) => {
                  if (i > 0) boundary(i - 1, Number(e.target.value));
                }}
              />
            </label>
            <label htmlFor={`${idPrefix}-lower-${i}`}>
              下限（含）
              <Input
                id={`${idPrefix}-lower-${i}`}
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={r.min}
                readOnly={i === 3}
                disabled={disabled}
                onChange={(e) => {
                  if (i < 3) boundary(i, Number(e.target.value));
                }}
              />
            </label>
            <p className="mini-label">
              {r.min.toFixed(1)} ≤ 系数 {r.includeMax ? '≤' : '<'}{' '}
              {r.max.toFixed(1)}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
