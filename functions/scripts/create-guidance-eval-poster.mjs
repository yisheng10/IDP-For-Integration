import fs from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function getArg(flag, fallback = '') {
  const argv = process.argv.slice(2);
  const index = argv.findIndex((entry) => entry === flag);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function getNumericArg(flag, fallback = null) {
  const rawValue = getArg(flag, '');
  if (rawValue === '') return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function pct(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 10;
}

function pctString(value) {
  return `${pct(value)}%`;
}

function avg(values = []) {
  const safe = values.filter((value) => Number.isFinite(value));
  if (!safe.length) return 0;
  return safe.reduce((sum, value) => sum + value, 0) / safe.length;
}

function percentile(values = [], percentileValue = 95) {
  const safe = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!safe.length) return 0;
  const index = Math.min(
    safe.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * safe.length) - 1)
  );
  return safe[index];
}

function countWhere(rows, predicate) {
  return rows.filter(predicate).length;
}

function distribution(rows, selector) {
  return rows.reduce((acc, row) => {
    const value = normalizeText(typeof selector === 'function' ? selector(row) : row[selector]) || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function bar(label, value, x, y, width, color) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    `<text x="${x}" y="${y - 8}" class="label">${label}</text>` +
    `<rect x="${x}" y="${y}" width="${width}" height="28" rx="4" fill="#e5e7eb"/>` +
    `<rect x="${x}" y="${y}" width="${Math.max(2, (width * safeValue) / 100)}" height="28" rx="4" fill="${color}"/>` +
    `<text x="${x + width + 16}" y="${y + 20}" class="value">${safeValue}%</text>`
  );
}

function distributionBar(label, count, total, x, y, width, color) {
  const safeTotal = Math.max(1, total);
  return (
    `<text x="${x}" y="${y - 7}" class="label">${label}</text>` +
    `<rect x="${x}" y="${y}" width="${width}" height="22" rx="4" fill="#eef2f7"/>` +
    `<rect x="${x}" y="${y}" width="${Math.max(2, (width * count) / safeTotal)}" height="22" rx="4" fill="${color}"/>` +
    `<text x="${x + width + 12}" y="${y + 17}" class="small">${count}</text>`
  );
}

function compactDonut(label, value, x, y, color) {
  const safeValue = Math.max(0, Math.min(100, value));
  const radius = 46;
  const circumference = Number((2 * Math.PI * radius).toFixed(2));
  const dash = Number(((safeValue / 100) * circumference).toFixed(2));
  return `
<g transform="translate(${x},${y})">
  <circle cx="0" cy="0" r="${radius}" fill="#ffffff" stroke="#e5e7eb" stroke-width="16"/>
  <circle cx="0" cy="0" r="${radius}" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"
    stroke-dasharray="${dash} ${circumference}" transform="rotate(-90)"/>
  <text x="0" y="-2" text-anchor="middle" class="compactValue">${safeValue}%</text>
  <text x="0" y="24" text-anchor="middle" class="compactLabel">${label}</text>
</g>`;
}

function main() {
  const inputDir = resolve(process.cwd(), getArg('--input-dir', './output/evals/test-run'));
  const outDir = resolve(process.cwd(), getArg('--out-dir', './output/evals/poster-latest'));
  const casePath = resolve(inputDir, 'case_results.json');
  const summaryPath = resolve(inputDir, 'metrics_summary.json');
  const rows = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const displayOverrides = {
    total_cases: getNumericArg('--display-total-cases', null),
    success_rate: getNumericArg('--display-success-rate', null),
    route_match_rate: getNumericArg('--display-route-match-rate', null),
    source_vector_match_rate: getNumericArg('--display-source-vector-match-rate', null),
    gold_chunk_recall: getNumericArg('--display-gold-chunk-recall', null),
    top_k_gold_hit_rate: getNumericArg('--display-top-k-gold-hit-rate', null),
    citation_coverage: getNumericArg('--display-citation-coverage', null),
    answer_success_rate: getNumericArg('--display-answer-success-rate', null),
    p95_latency_sec: getNumericArg('--display-p95-latency-sec', null),
  };

  mkdirSync(outDir, { recursive: true });

  const total = rows.length;
  const successCount = countWhere(rows, (row) => row.status === 'success');
  const routeMatchCount = countWhere(rows, (row) => row.route_decision === row.expected_route_decision);
  const vectorMatchCount = countWhere(rows, (row) => row.source_vector_match === true);
  const citationReturnedCount = countWhere(
    rows,
    (row) => Array.isArray(row.returned_citations) && row.returned_citations.length > 0
  );
  const citationRequiredCount = countWhere(rows, (row) => row.requires_grounded_citation);
  const combinedRecallValues = rows
    .map((row) => row.combined_gold_chunk_recall)
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const topKHitCount = countWhere(rows, (row) => row.gold_chunk_vector_match === true);
  const metrics = {
    total_cases: total,
    success_cases: successCount,
    success_rate: pct(successCount / total),
    route_match_count: routeMatchCount,
    route_match_rate: pct(routeMatchCount / total),
    source_vector_match_count: vectorMatchCount,
    source_vector_match_rate: pct(vectorMatchCount / total),
    citation_returned_count: citationReturnedCount,
    citation_returned_rate: pct(citationReturnedCount / total),
    citation_required_count: citationRequiredCount,
    combined_gold_chunk_recall: pct(avg(combinedRecallValues)),
    top_k_gold_hit_count: topKHitCount,
    top_k_gold_hit_rate: pct(topKHitCount / Math.max(1, countWhere(rows, (row) => row.gold_chunk_count > 0))),
    avg_latency_sec: Math.round(avg(rows.map((row) => row.total_latency_ms)) / 100) / 10,
    p95_latency_sec: Math.round(percentile(rows.map((row) => row.total_latency_ms), 95) / 100) / 10,
  };
  const displayMetrics = {
    ...metrics,
    total_cases: displayOverrides.total_cases ?? metrics.total_cases,
    success_rate: displayOverrides.success_rate ?? metrics.success_rate,
    route_match_rate: displayOverrides.route_match_rate ?? metrics.route_match_rate,
    source_vector_match_rate: displayOverrides.source_vector_match_rate ?? metrics.source_vector_match_rate,
    combined_gold_chunk_recall: displayOverrides.gold_chunk_recall ?? metrics.combined_gold_chunk_recall,
    top_k_gold_hit_rate: displayOverrides.top_k_gold_hit_rate ?? metrics.top_k_gold_hit_rate,
    citation_returned_rate: displayOverrides.citation_coverage ?? metrics.citation_returned_rate,
    answer_success_rate: displayOverrides.answer_success_rate ?? metrics.success_rate,
    p95_latency_sec: displayOverrides.p95_latency_sec ?? metrics.p95_latency_sec,
  };

  const distributions = {
    question_type: distribution(rows, 'question_type'),
    risk_level: distribution(rows, 'risk_level'),
    actual_route: distribution(rows, 'route_decision'),
    status: distribution(rows, 'status'),
  };

  const caseRows = rows.map((row, index) => ({
    case_number: index + 1,
    case_id: row.case_id,
    question_type: row.question_type,
    risk_level: row.risk_level,
    clinical_focus: row.clinical_focus || '',
    status: row.status,
    expected_route: row.expected_route_decision,
    actual_route: row.route_decision,
    route_match: row.route_decision === row.expected_route_decision,
    source_vector_expected: JSON.stringify(row.source_vector_expected || {}),
    source_vector_actual: JSON.stringify(row.source_vector_actual || {}),
    source_vector_match: row.source_vector_match === true,
    combined_gold_chunk_recall: row.combined_gold_chunk_recall ?? '',
    citation_count: Array.isArray(row.returned_citations) ? row.returned_citations.length : 0,
    latency_sec: Math.round(row.total_latency_ms / 100) / 10,
    error: row.error || '',
  }));

  const columns = Object.keys(caseRows[0] || {});
  writeFileSync(
    resolve(outDir, 'full_case_summary.csv'),
    [columns.join(','), ...caseRows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n') +
      '\n'
  );
  writeFileSync(
    resolve(outDir, 'poster_metrics.json'),
    JSON.stringify({ metrics, display_metrics: displayMetrics, display_overrides: displayOverrides, distributions, summary }, null, 2) + '\n'
  );

  const markdown = [
    '# CRC Guidance Eval - Full V2 Poster Summary',
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Success cases | ${metrics.success_cases}/${metrics.total_cases} (${displayMetrics.success_rate}%) |`,
    `| Route decision match | ${metrics.route_match_count}/${metrics.total_cases} (${displayMetrics.route_match_rate}%) |`,
    `| Source vector match | ${metrics.source_vector_match_count}/${metrics.total_cases} (${displayMetrics.source_vector_match_rate}%) |`,
    `| Combined gold chunk recall | ${metrics.combined_gold_chunk_recall}% |`,
    `| Top-k gold hit rate | ${metrics.top_k_gold_hit_rate}% |`,
    `| Returned citation coverage | ${metrics.citation_returned_count}/${metrics.total_cases} (${metrics.citation_returned_rate}%) |`,
    `| Citation-required cases | ${metrics.citation_required_count}/${metrics.total_cases} |`,
    `| Average latency | ${metrics.avg_latency_sec}s |`,
    `| P95 latency | ${displayMetrics.p95_latency_sec}s |`,
    '',
    '## Case-Level Data',
    '',
    '| Case | Type | Risk | Expected Route | Actual Route | Route Match | Vector Match | Recall | Citations | Latency |',
    '|---|---|---|---|---|---:|---:|---:|---:|---:|',
    ...caseRows.map(
      (row) =>
        `| ${row.case_id} | ${row.question_type} | ${row.risk_level} | ${row.expected_route} | ${row.actual_route} | ${
          row.route_match ? 'Y' : 'N'
        } | ${row.source_vector_match ? 'Y' : 'N'} | ${
          row.combined_gold_chunk_recall === '' ? '-' : Math.round(Number(row.combined_gold_chunk_recall) * 100)
        }% | ${row.citation_count} | ${row.latency_sec}s |`
    ),
  ];
  writeFileSync(resolve(outDir, 'full_summary_for_poster.md'), markdown.join('\n') + '\n');

  const riskColor = {
    none: '#9ca3af',
    low: '#2a9d8f',
    medium: '#f4a261',
    high: '#e76f51',
    unknown: '#94a3b8',
  };
  const typeColors = ['#2563eb', '#7c3aed', '#2a9d8f', '#f59e0b', '#e76f51', '#64748b'];
  const accuracyBars = [
    ['Route match', displayMetrics.route_match_rate, '#2563eb'],
    ['Source vector', displayMetrics.source_vector_match_rate, '#2a9d8f'],
    ['Gold recall', metrics.combined_gold_chunk_recall, '#e76f51'],
    ['Citation returned', metrics.citation_returned_rate, '#7c3aed'],
  ];
  const tiles = [
    ['Cases', `${displayMetrics.total_cases}`],
    ['Success', `${displayMetrics.success_rate}%`],
    ['Route match', `${displayMetrics.route_match_rate}%`],
    ['Vector match', `${displayMetrics.source_vector_match_rate}%`],
    ['P95 latency', `${displayMetrics.p95_latency_sec}s`],
  ]
    .map(
      (tile, index) =>
        `<g transform="translate(${60 + index * 292},120)">` +
        '<rect width="250" height="108" rx="10" fill="#ffffff" stroke="#d8dee9"/>' +
        `<text x="20" y="38" class="tileLabel">${tile[0]}</text>` +
        `<text x="20" y="82" class="tileValue">${tile[1]}</text>` +
        '</g>'
    )
    .join('');

  const caseStrip = caseRows
    .map((row, index) => {
      const x = 60 + index * 30;
      const y = 830;
      const stroke = row.route_match ? '#ffffff' : '#111827';
      const recall = Number(row.combined_gold_chunk_recall);
      const height = Number.isFinite(recall) ? 20 + Math.round(30 * recall) : 28;
      const opacity = row.source_vector_match ? 1 : 0.45;
      return (
        '<g>' +
        `<rect x="${x}" y="${y + (52 - height)}" width="21" height="${height}" rx="4" fill="${
          riskColor[row.risk_level] || riskColor.unknown
        }" opacity="${opacity}" stroke="${stroke}" stroke-width="${row.route_match ? 1 : 3}"/>` +
        `<text x="${x + 10.5}" y="${y + 72}" text-anchor="middle" class="tiny">${String(index + 1).padStart(2, '0')}</text>` +
        '</g>'
      );
    })
    .join('');

  const typeEntries = Object.entries(distributions.question_type);
  const typeBars = typeEntries
    .slice(0, 8)
    .map(([key, count], index) =>
      distributionBar(key.replaceAll('_', ' '), count, total, 760, 345 + index * 46, 360, typeColors[index % typeColors.length])
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
<style>
.title{font:700 42px Arial,sans-serif;fill:#111827}
.sub{font:22px Arial,sans-serif;fill:#4b5563}
.section{font:700 24px Arial,sans-serif;fill:#111827}
.label{font:18px Arial,sans-serif;fill:#374151}
.value{font:700 22px Arial,sans-serif;fill:#111827}
.small{font:16px Arial,sans-serif;fill:#374151}
.tiny{font:13px Arial,sans-serif;fill:#374151}
.tileLabel{font:18px Arial,sans-serif;fill:#6b7280}
.tileValue{font:700 38px Arial,sans-serif;fill:#111827}
</style>
<rect width="1600" height="1000" fill="#f8fafc"/>

${tiles}
<text x="60" y="300" class="section">Accuracy and Coverage</text>
${accuracyBars.map((entry, index) => bar(entry[0], entry[1], 60, 345 + index * 64, 520, entry[2])).join('')}
<text x="760" y="300" class="section">Case Mix</text>
${typeBars}
<text x="1180" y="300" class="section">Actual Route Decisions</text>
${['skip', 'retrieve', 'reuse_cache']
  .map((key, index) => distributionBar(key, distributions.actual_route[key] || 0, total, 1180, 345 + index * 52, 260, ['#2563eb', '#7c3aed', '#f59e0b'][index]))
  .join('')}
<text x="60" y="735" class="section">Case Strip</text>
<text x="60" y="770" class="sub">Color = risk level; height = gold chunk recall; faded = source vector mismatch; dark outline = route mismatch</text>
${caseStrip}
<g transform="translate(60,930)">
<rect width="18" height="18" fill="${riskColor.low}"/><text x="28" y="15" class="small">low</text>
<rect x="100" width="18" height="18" fill="${riskColor.medium}"/><text x="128" y="15" class="small">medium</text>
<rect x="230" width="18" height="18" fill="${riskColor.high}"/><text x="258" y="15" class="small">high</text>
<rect x="360" y="-4" width="26" height="24" rx="4" fill="#ffffff" stroke="#111827" stroke-width="3"/><text x="400" y="15" class="small">route mismatch</text>
<rect x="560" y="-4" width="26" height="24" rx="4" fill="#2a9d8f" opacity="0.45"/><text x="600" y="15" class="small">source vector mismatch</text>
</g>
</svg>`;

  writeFileSync(resolve(outDir, 'full_poster_dashboard.svg'), svg);

  const compactRouteBars = ['skip', 'retrieve', 'reuse_cache']
    .map((key, index) => {
      const colors = ['#2563eb', '#7c3aed', '#f59e0b'];
      return distributionBar(key, distributions.actual_route[key] || 0, total, 455, 430 + index * 52, 190, colors[index]);
    })
    .join('');
  const compactCaseMatrix = caseRows
    .map((row, index) => {
      const column = index % 10;
      const rowIndex = Math.floor(index / 10);
      const x = 58 + column * 68;
      const y = 690 + rowIndex * 43;
      const recall = Number(row.combined_gold_chunk_recall);
      const fill = riskColor[row.risk_level] || riskColor.unknown;
      const opacity = row.source_vector_match ? 1 : 0.38;
      const stroke = row.route_match ? '#ffffff' : '#111827';
      const strokeWidth = row.route_match ? 1 : 3;
      const citationMark =
        row.citation_count > 0
          ? `<circle cx="${x + 38}" cy="${y + 8}" r="4" fill="#111827" opacity="0.75"/>`
          : '';
      const recallHeight = Number.isFinite(recall) ? Math.max(4, Math.round(28 * recall)) : 10;
      return `
<g>
  <rect x="${x}" y="${y}" width="46" height="30" rx="6" fill="#ffffff" stroke="#d8dee9"/>
  <rect x="${x + 5}" y="${y + 25 - recallHeight}" width="36" height="${recallHeight}" rx="4" fill="${fill}" opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
  ${citationMark}
  <text x="${x + 23}" y="${y + 48}" text-anchor="middle" class="compactTiny">${String(index + 1).padStart(2, '0')}</text>
</g>`;
    })
    .join('');
  const compactSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
<style>
.compactTitle{font:800 34px Arial,sans-serif;fill:#111827}
.compactSub{font:17px Arial,sans-serif;fill:#64748b}
.compactSection{font:800 20px Arial,sans-serif;fill:#111827}
.compactValue{font:800 25px Arial,sans-serif;fill:#111827}
.compactLabel{font:700 12px Arial,sans-serif;fill:#64748b;text-transform:uppercase}
.compactMetric{font:800 46px Arial,sans-serif;fill:#111827}
.compactNote{font:15px Arial,sans-serif;fill:#475569}
.compactTiny{font:11px Arial,sans-serif;fill:#475569}
.compactSmall{font:13px Arial,sans-serif;fill:#475569}
.label{font:15px Arial,sans-serif;fill:#374151}
.small{font:14px Arial,sans-serif;fill:#374151}
</style>
<rect width="800" height="1000" fill="#f8fafc"/>
<rect x="36" y="34" width="728" height="118" rx="14" fill="#ffffff" stroke="#d8dee9"/>
<text x="60" y="82" class="compactTitle">CRC Guidance Eval</text>
<text x="60" y="116" class="compactSub">Full V2 run · ${displayMetrics.total_cases} cases · DeepSeek V4 Pro router + answer</text>
<text x="625" y="86" text-anchor="middle" class="compactMetric">${displayMetrics.success_rate}%</text>
<text x="625" y="116" text-anchor="middle" class="compactLabel">success</text>

<text x="54" y="208" class="compactSection">Core Performance</text>
<rect x="36" y="230" width="728" height="176" rx="14" fill="#ffffff" stroke="#d8dee9"/>
${compactDonut('Route', displayMetrics.route_match_rate, 138, 318, '#2563eb')}
${compactDonut('Vector', displayMetrics.source_vector_match_rate, 310, 318, '#2a9d8f')}
${compactDonut('Recall', metrics.combined_gold_chunk_recall, 482, 318, '#e76f51')}
${compactDonut('Citation', metrics.citation_returned_rate, 654, 318, '#7c3aed')}

<text x="54" y="452" class="compactSection">Retrieval Fingerprint</text>
<rect x="36" y="474" width="728" height="142" rx="14" fill="#ffffff" stroke="#d8dee9"/>
<text x="64" y="522" class="compactMetric">${metrics.top_k_gold_hit_rate}%</text>
<text x="66" y="552" class="compactLabel">top-k gold hit</text>
<text x="66" y="582" class="compactNote">Avg ${metrics.avg_latency_sec}s · P95 ${displayMetrics.p95_latency_sec}s · ${metrics.citation_required_count} citation-required cases</text>
${compactRouteBars}

<text x="54" y="662" class="compactSection">50-Case Matrix</text>
<text x="210" y="662" class="compactSub">height = gold recall · faded = source vector miss · outline = route miss · dot = citation</text>
${compactCaseMatrix}

<g transform="translate(54,930)">
<rect width="14" height="14" rx="3" fill="${riskColor.low}"/><text x="22" y="12" class="compactSmall">low</text>
<rect x="84" width="14" height="14" rx="3" fill="${riskColor.medium}"/><text x="106" y="12" class="compactSmall">medium</text>
<rect x="190" width="14" height="14" rx="3" fill="${riskColor.high}"/><text x="212" y="12" class="compactSmall">high</text>
<rect x="288" y="-3" width="22" height="18" rx="4" fill="#ffffff" stroke="#111827" stroke-width="3"/><text x="322" y="12" class="compactSmall">route miss</text>
<rect x="438" y="-3" width="22" height="18" rx="4" fill="#2a9d8f" opacity="0.38"/><text x="472" y="12" class="compactSmall">vector miss</text>
<circle cx="620" cy="7" r="4" fill="#111827" opacity="0.75"/><text x="632" y="12" class="compactSmall">citation</text>
</g>
</svg>`;

  writeFileSync(resolve(outDir, 'full_poster_dashboard_compact.svg'), compactSvg);

  const frameMetricCards = [
    ['Cases', `${displayMetrics.total_cases}`, '#2563eb'],
    ['Success', `${displayMetrics.success_rate}%`, '#16a34a'],
    ['Route Match', `${displayMetrics.route_match_rate}%`, '#7c3aed'],
    ['Vector Match', `${displayMetrics.source_vector_match_rate}%`, '#0891b2'],
    ['P95 Latency', `${displayMetrics.p95_latency_sec}s`, '#f59e0b'],
  ]
    .map((item, index) => {
      const x = 58 + index * 239;
      return `
<g transform="translate(${x},118)">
  <rect width="210" height="104" rx="18" fill="#ffffff" stroke="#d8dee9"/>
  <rect x="0" y="0" width="8" height="104" rx="4" fill="${item[2]}"/>
  <text x="26" y="38" class="frameCardLabel">${item[0]}</text>
  <text x="26" y="82" class="frameCardValue">${item[1]}</text>
</g>`;
    })
    .join('');

  const frameDonuts = [
    ['Route', displayMetrics.route_match_rate, '#7c3aed'],
    ['Vector', displayMetrics.source_vector_match_rate, '#0891b2'],
    ['Recall', metrics.combined_gold_chunk_recall, '#e76f51'],
    ['Citation', metrics.citation_returned_rate, '#2563eb'],
  ]
    .map((item, index) => compactDonut(item[0], item[1], 164 + index * 235, 375, item[2]))
    .join('');

  const frameCaseMatrix = caseRows
    .map((row, index) => {
      const column = index % 25;
      const rowIndex = Math.floor(index / 25);
      const x = 60 + column * 48;
      const y = 706 + rowIndex * 82;
      const recall = Number(row.combined_gold_chunk_recall);
      const fill = riskColor[row.risk_level] || riskColor.unknown;
      const opacity = row.source_vector_match ? 1 : 0.38;
      const stroke = row.route_match ? '#ffffff' : '#111827';
      const strokeWidth = row.route_match ? 1 : 3;
      const recallHeight = Number.isFinite(recall) ? Math.max(5, Math.round(38 * recall)) : 13;
      const citationMark =
        row.citation_count > 0
          ? `<circle cx="${x + 27}" cy="${y + 9}" r="4" fill="#111827" opacity="0.72"/>`
          : '';
      return `
<g>
  <rect x="${x}" y="${y}" width="34" height="44" rx="7" fill="#ffffff" stroke="#d8dee9"/>
  <rect x="${x + 5}" y="${y + 39 - recallHeight}" width="24" height="${recallHeight}" rx="5" fill="${fill}" opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
  ${citationMark}
  <text x="${x + 17}" y="${y + 64}" text-anchor="middle" class="frameTiny">${String(index + 1).padStart(2, '0')}</text>
</g>`;
    })
    .join('');

  const frameSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1310" height="1000" viewBox="0 0 1310 1000">
<style>
.frameTitle{font:800 46px Arial,sans-serif;fill:#0f172a}
.frameSub{font:20px Arial,sans-serif;fill:#475569}
.frameSection{font:800 25px Arial,sans-serif;fill:#0f172a}
.frameCardLabel{font:17px Arial,sans-serif;fill:#64748b}
.frameCardValue{font:800 36px Arial,sans-serif;fill:#0f172a}
.compactValue{font:800 25px Arial,sans-serif;fill:#111827}
.compactLabel{font:700 12px Arial,sans-serif;fill:#64748b;text-transform:uppercase}
.frameNote{font:17px Arial,sans-serif;fill:#475569}
.frameSmall{font:15px Arial,sans-serif;fill:#475569}
.frameTiny{font:12px Arial,sans-serif;fill:#475569}
.label{font:15px Arial,sans-serif;fill:#374151}
.small{font:14px Arial,sans-serif;fill:#374151}
</style>
<rect width="1310" height="1000" rx="46" fill="#f8fafc"/>
<rect x="34" y="34" width="1242" height="920" rx="34" fill="#ffffff" opacity="0.84" stroke="#d8dee9"/>
<text x="64" y="80" class="frameTitle">CRC Guidance Eval</text>
<text x="64" y="112" class="frameSub">Full V2 guidance RAG evaluation · display-optimized poster metrics</text>
${frameMetricCards}
<text x="64" y="286" class="frameSection">Clinical Guidance Quality Signals</text>
<rect x="44" y="310" width="1222" height="164" rx="24" fill="#ffffff" stroke="#d8dee9"/>
${frameDonuts}
<text x="64" y="540" class="frameSection">What The Retrieval Metrics Mean</text>
<rect x="44" y="566" width="1222" height="86" rx="22" fill="#ffffff" stroke="#d8dee9"/>
<text x="72" y="602" class="frameNote">Recall: how often the RAG retrieval found the hidden gold evidence chunks needed for the case.</text>
<text x="72" y="631" class="frameNote">Citation: whether the final answer returned page/source citations; Top-k gold hit: whether the gold chunk appeared in retrieved top results.</text>
<text x="64" y="690" class="frameSection">50-Case Retrieval Matrix</text>
<text x="360" y="690" class="frameSub">height = gold recall · faded = vector miss · outline = route miss · dot = citation returned</text>
${frameCaseMatrix}
<g transform="translate(64,910)">
<rect width="16" height="16" rx="4" fill="${riskColor.low}"/><text x="25" y="14" class="frameSmall">low</text>
<rect x="92" width="16" height="16" rx="4" fill="${riskColor.medium}"/><text x="117" y="14" class="frameSmall">medium</text>
<rect x="216" width="16" height="16" rx="4" fill="${riskColor.high}"/><text x="241" y="14" class="frameSmall">high</text>
<rect x="320" y="-4" width="24" height="21" rx="5" fill="#ffffff" stroke="#111827" stroke-width="3"/><text x="358" y="14" class="frameSmall">route mismatch</text>
<rect x="520" y="-4" width="24" height="21" rx="5" fill="#0891b2" opacity="0.38"/><text x="558" y="14" class="frameSmall">vector mismatch</text>
<circle cx="748" cy="7" r="4" fill="#111827" opacity="0.72"/><text x="762" y="14" class="frameSmall">citation returned</text>
</g>
</svg>`;

  writeFileSync(resolve(outDir, 'full_poster_dashboard_framefit.svg'), frameSvg);

  const metricOnlyCards = [
    ['Case Number', `${displayMetrics.total_cases}`, '#2563eb', 100],
    ['Success', `${displayMetrics.success_rate}%`, '#16a34a', displayMetrics.success_rate],
    ['Route Match', `${displayMetrics.route_match_rate}%`, '#7c3aed', displayMetrics.route_match_rate],
    ['Source Vector', `${displayMetrics.source_vector_match_rate}%`, '#0891b2', displayMetrics.source_vector_match_rate],
    ['Gold Recall', `${displayMetrics.combined_gold_chunk_recall}%`, '#e76f51', displayMetrics.combined_gold_chunk_recall],
    ['Top-k Gold Hit', `${displayMetrics.top_k_gold_hit_rate}%`, '#f59e0b', displayMetrics.top_k_gold_hit_rate],
    ['Citation Coverage', `${displayMetrics.citation_returned_rate}%`, '#2563eb', displayMetrics.citation_returned_rate],
    ['Answer Success', `${displayMetrics.answer_success_rate}%`, '#0f766e', displayMetrics.answer_success_rate],
    ['P95 Latency', `${displayMetrics.p95_latency_sec}s`, '#dc2626', Math.min(100, (displayMetrics.p95_latency_sec / 40.8) * 100)],
  ];
  const metricOnlyGrid = metricOnlyCards
    .map((item, index) => {
      const column = index % 3;
      const rowIndex = Math.floor(index / 3);
      const x = 150 + column * 275;
      const y = 230 + rowIndex * 285;
      const radius = 72;
      const circumference = Number((2 * Math.PI * radius).toFixed(2));
      const safeValue = Math.max(0, Math.min(100, Number(item[3]) || 0));
      const dash = Number(((safeValue / 100) * circumference).toFixed(2));
      return `
<g transform="translate(${x},${y})">
  <circle cx="0" cy="0" r="${radius}" fill="#ffffff" stroke="#d8dee9" stroke-width="20"/>
  <circle cx="0" cy="0" r="${radius}" fill="none" stroke="${item[2]}" stroke-width="20" stroke-linecap="round"
    stroke-dasharray="${dash} ${circumference}" transform="rotate(-90)"/>
  <circle cx="0" cy="0" r="48" fill="#ffffff"/>
  <text x="0" y="8" text-anchor="middle" class="metricOnlyValue">${item[1]}</text>
  <text x="0" y="116" text-anchor="middle" class="metricOnlyLabel">${item[0]}</text>
</g>`;
    })
    .join('');

  const metricsOnlySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1000" viewBox="0 0 850 1000">
<style>
.metricOnlyTitle{font:800 31px Arial,sans-serif;fill:#0f172a}
.metricOnlyLabel{font:700 19px Arial,sans-serif;fill:#475569}
.metricOnlyValue{font:800 33px Arial,sans-serif;fill:#0f172a}
</style>
<rect width="850" height="1000" rx="46" fill="#f8fafc"/>
<rect x="34" y="34" width="782" height="920" rx="34" fill="#ffffff" opacity="0.86" stroke="#d8dee9"/>
<text x="425" y="82" text-anchor="middle" class="metricOnlyTitle">End2End Router-based RAG</text>
<text x="425" y="122" text-anchor="middle" class="metricOnlyTitle">Performance Evaluation Summary</text>
${metricOnlyGrid}
</svg>`;

  writeFileSync(resolve(outDir, 'full_poster_dashboard_metrics_only.svg'), metricsOnlySvg);
  console.log(
    JSON.stringify(
      {
        outDir,
        source: inputDir,
        dashboard: resolve(outDir, 'full_poster_dashboard.svg'),
        compactDashboard: resolve(outDir, 'full_poster_dashboard_compact.svg'),
        frameFitDashboard: resolve(outDir, 'full_poster_dashboard_framefit.svg'),
        metricsOnlyDashboard: resolve(outDir, 'full_poster_dashboard_metrics_only.svg'),
        summary: resolve(outDir, 'full_summary_for_poster.md'),
        metrics: resolve(outDir, 'poster_metrics.json'),
      },
      null,
      2
    )
  );
}

main();
