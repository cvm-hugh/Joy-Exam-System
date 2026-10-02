'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { Result } from '@/lib/domain';

const TITLE_FONTS = {
  rounded: "'Arial Rounded MT Bold', 'Arial Rounded MT', Arial, sans-serif",
  sans: "Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  serif: "Georgia, 'Songti SC', SimSun, serif",
};

function ReportPage({
  number,
  title,
  className = '',
  children,
}: {
  number: number;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={`standard-report-page ${className}`}
      data-report-page={number}
      data-report-title={title}
      aria-label={`第${number}页 ${title}`}
    >
      {children}
    </article>
  );
}

function AbilityRadar({ result }: { result: Result }) {
  const cx = 160;
  const cy = 160;
  const radius = 88;
  const point = (index: number, ratio: number) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3;
    return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio];
  };
  const polygon = (values: number[]) =>
    values.map((value, index) => point(index, value).join(',')).join(' ');
  return (
    <svg className="standard-ability-radar" viewBox="0 0 320 320">
      <title>六维得分系数图</title>
      {[1, 0.8, 0.6, 0.4, 0.2].map((value, index) => (
        <polygon
          key={value}
          points={polygon(Array(6).fill(value))}
          fill={index % 2 ? '#eeeeee' : '#ffffff'}
          stroke="#cccccc"
          strokeWidth="1"
        />
      ))}
      {result.dimensions.map((_, index) => {
        const [x, y] = point(index, 1);
        return <line key={index} x1={cx} y1={cy} x2={x} y2={y} stroke="#cccccc" strokeWidth="1" />;
      })}
      <polygon
        points={polygon(result.dimensions.map((dimension) => dimension.percent / 100))}
        fill="none"
        stroke="#d83232"
        strokeWidth="2.2"
      />
      {result.dimensions.map((dimension, index) => {
        const [dotX, dotY] = point(index, dimension.percent / 100);
        const [labelX, labelY] = point(index, 1.38);
        const nameLines = dimension.name.length > 4
          ? [dimension.name.slice(0, 2), dimension.name.slice(2)]
          : [dimension.name];
        return (
          <g key={dimension.id}>
            <circle cx={dotX} cy={dotY} r="3" fill="#fff" stroke="#d83232" strokeWidth="1.5" />
            <text x={labelX} y={labelY - (nameLines.length - 1) * 7} textAnchor="middle" fill="#999" fontSize="12">
              {nameLines.map((line, lineIndex) => (
                <tspan key={lineIndex} x={labelX} dy={lineIndex ? 15 : 0}>{line}</tspan>
              ))}
              <tspan x={labelX} dy="16">{dimension.coefficient}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EvaluationPage({ result, index }: { result: Result; index: number }) {
  const dimension = result.dimensions[index];
  const headingStyle: CSSProperties = {
    fontFamily: TITLE_FONTS[result.pageCopy.learningHeadingFont],
    fontSize: `${result.pageCopy.learningHeadingSize}px`,
  };
  return (
    <ReportPage
      number={index + 4}
      title={dimension.name}
      className={`standard-evaluation-page${dimension.name === '阅读理解' ? ' is-reading-dimension' : ''}`}
    >
      <header className="standard-learning-header">
        <h1 style={headingStyle}>{result.pageCopy.learningHeading}</h1>
        <p>{result.pageCopy.learningLabel}</p>
      </header>
      <div className="standard-evaluation-card">
        <div className="standard-evaluation-title">
          <h2>{dimension.name}</h2>
          <strong>{dimension.grade}</strong>
        </div>
        <section className="standard-grade-section">
          <div className="standard-grade-list">
            {dimension.gradeDescriptions.map((item) => (
              <div className={`standard-grade-row${item.selected ? ' is-current' : ''}`} key={item.grade}>
                <i aria-hidden="true">{item.selected ? '✓' : ''}</i>
                <strong>{item.grade}</strong>
                <p>{item.description}</p>
              </div>
            ))}
          </div>
        </section>
        {[1, 2].map((paragraphIndex) => (
          <section className="standard-advice" key={paragraphIndex}>
            <h3>{result.paragraphTitles[paragraphIndex]}</h3>
            <p>{dimension.evaluation.paragraphs[paragraphIndex]}</p>
          </section>
        ))}
        {dimension.evaluation.image && (
          <img src={dimension.evaluation.image} alt={`${dimension.name}评价图片`} />
        )}
      </div>
    </ReportPage>
  );
}

export function ReportPages({ result }: { result: Result }) {
  const abilityHeadingStyle: CSSProperties = {
    fontFamily: TITLE_FONTS[result.pageCopy.abilityHeadingFont],
    fontSize: `${result.pageCopy.abilityHeadingSize}px`,
  };
  return (
    <div className="standard-report-pages">
      <ReportPage number={1} title="学生信息" className="standard-student-page">
        <p className="standard-exam-name">{result.examName}</p>
        <div className="standard-student-identity">
          <h1>{result.name}</h1>
          <p>{result.branch}</p>
        </div>
      </ReportPage>

      <ReportPage number={2} title="资格结果" className={`standard-admission-page ${result.admission?.qualifiedForInterview ? 'is-interview' : 'is-course'}`}>
        <div className="standard-admission-mark">{result.admission?.qualifiedForInterview ? '✦' : '✓'}</div>
        {result.admission ? (
          <>
            {(() => {
              const blocks = result.admission.message
                .split(/\n\s*\n/)
                .map((block) => block.trim())
                .filter(Boolean);
              const structured = blocks.length > 1;
              return (
                <div className="standard-admission-copy">
                  <h1>{structured ? blocks[0] : 'Congratulations！🎉'}</h1>
                  <p className="standard-admission-primary">{structured ? blocks[1] : blocks[0]}</p>
                  {result.admission.qualifiedForInterview && blocks.length > 2 && (
                    <p className="standard-admission-interview">{blocks.slice(2).join('\n\n')}</p>
                  )}
                </div>
              );
            })()}
            {result.admission.note && <small>{result.admission.note}</small>}
          </>
        ) : (
          <p>本套试卷暂未启用资格发布。</p>
        )}
      </ReportPage>

      <ReportPage number={3} title="六维能力图" className="standard-ability-page">
        <header>
          <h1 style={abilityHeadingStyle}>{result.pageCopy.abilityHeading}</h1>
          <p>{result.pageCopy.abilitySubtitle}</p>
        </header>
        <AbilityRadar result={result} />
        <p className="standard-chart-note">得分系数=维度得分占维度总分的百分比</p>
      </ReportPage>

      {result.dimensions.map((dimension, index) => (
        <EvaluationPage result={result} index={index} key={dimension.id} />
      ))}
    </div>
  );
}
