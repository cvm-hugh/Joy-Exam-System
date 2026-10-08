'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { Result } from '@/lib/domain';
import type { ReportPreviewScale } from './report-preview-scale';

const TITLE_FONTS = {
  rounded: "'Arial Rounded MT Bold', 'Arial Rounded MT', Arial, sans-serif",
  sans: "Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  serif: "Georgia, 'Songti SC', SimSun, serif",
};

// 这些字号与报告样式中的固定字号对应；自定义标题另按配置计算。
const REPORT_FONT_SIZES = [10, 12, 13, 14, 15, 18, 20, 21, 24, 38, 48] as const;

function previewFontSize(baseSize: number, scale: ReportPreviewScale) {
  if (scale === 100) return baseSize;
  const ratio = scale / 100;
  // 外层 zoom 缩放页面几何尺寸；抵消这一次字体缩放，使最终显示字号取整。
  return Math.round(baseSize * ratio) / ratio;
}

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

function AbilityRadar({ result, previewScale }: { result: Result; previewScale: ReportPreviewScale }) {
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
            <text x={labelX} y={labelY - (nameLines.length - 1) * 7} textAnchor="middle" fill="#999" fontSize={previewFontSize(12, previewScale)}>
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

function EvaluationPage({ result, index, previewScale }: { result: Result; index: number; previewScale: ReportPreviewScale }) {
  const dimension = result.dimensions[index];
  const headingStyle: CSSProperties = {
    fontFamily: TITLE_FONTS[result.pageCopy.learningHeadingFont],
    fontSize: `${previewFontSize(result.pageCopy.learningHeadingSize, previewScale)}px`,
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

export function ReportPages({ result, previewScale = 100 }: { result: Result; previewScale?: ReportPreviewScale }) {
  const fontStyle = previewScale === 100 ? undefined : Object.fromEntries(
    REPORT_FONT_SIZES.map((size) => [`--report-font-${size}`, `${previewFontSize(size, previewScale)}px`]),
  ) as CSSProperties;
  const abilityHeadingStyle: CSSProperties = {
    fontFamily: TITLE_FONTS[result.pageCopy.abilityHeadingFont],
    fontSize: `${previewFontSize(result.pageCopy.abilityHeadingSize, previewScale)}px`,
  };
  return (
    <div className="standard-report-pages" style={fontStyle}>
      <ReportPage number={1} title="学生信息" className="standard-student-page">
        <p className="standard-exam-name">{result.examName}</p>
        <div className="standard-student-identity">
          <h1>{result.name}</h1>
          <p>{result.branch}</p>
        </div>
      </ReportPage>

      <ReportPage number={2} title="资格结果" className={`standard-admission-page ${result.admission.qualifiedForInterview ? 'is-interview' : 'is-course'}`}>
        <div className="standard-admission-mark">{result.admission.qualifiedForInterview ? '✦' : '✓'}</div>
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
      </ReportPage>

      <ReportPage number={3} title="六维能力图" className="standard-ability-page">
        <header>
          <h1 style={abilityHeadingStyle}>{result.pageCopy.abilityHeading}</h1>
          <p>{result.pageCopy.abilitySubtitle}</p>
        </header>
        <AbilityRadar result={result} previewScale={previewScale} />
        <p className="standard-chart-note">得分系数=维度得分占维度总分的百分比</p>
      </ReportPage>

      {result.dimensions.map((dimension, index) => (
        <EvaluationPage result={result} index={index} previewScale={previewScale} key={dimension.id} />
      ))}
    </div>
  );
}
