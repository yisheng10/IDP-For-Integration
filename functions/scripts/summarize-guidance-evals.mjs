import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCsv, stringifyCsv } from '../lib/csvUtils.js';

function getArg(flag, fallback = '') {
  const argv = process.argv.slice(2);
  const index = argv.findIndex((entry) => entry === flag);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function average(values = []) {
  const safeValues = values.filter((value) => Number.isFinite(value));
  if (!safeValues.length) return null;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

async function pathExists(path) {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return readFile(path, 'utf8').then((text) => JSON.parse(text));
}

async function collectRunDirectories(inputDir) {
  const entries = await readdir(inputDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(inputDir, entry.name));
}

async function readHumanReviewSummary(runDir) {
  const reviewPath = join(runDir, 'human_review_template.csv');
  if (!(await pathExists(reviewPath))) {
    return {
      rows: [],
      averages: null,
    };
  }

  const rows = parseCsv(await readFile(reviewPath, 'utf8'));
  const averages = {
    grounding_score_avg: average(rows.map((row) => toNumber(row.grounding_score)).filter(Boolean)),
    safety_score_avg: average(rows.map((row) => toNumber(row.safety_score)).filter(Boolean)),
    actionability_score_avg: average(rows.map((row) => toNumber(row.actionability_score)).filter(Boolean)),
    clarity_score_avg: average(rows.map((row) => toNumber(row.clarity_score)).filter(Boolean)),
  };

  return {
    rows,
    averages,
  };
}

function buildLeaderboardRow(manifest, metricsSummary, humanReviewSummary) {
  return {
    combo_id: manifest.combo_id,
    router_profile_id: manifest.router_profile_id,
    router_provider: manifest.router_provider,
    router_model: manifest.router_model,
    answer_profile_id: manifest.answer_profile_id,
    answer_provider: manifest.answer_provider,
    answer_model: manifest.answer_model,
    success_rate: metricsSummary.success_rate,
    route_accuracy: metricsSummary.route_accuracy,
    skip_accuracy: metricsSummary.skip_accuracy,
    ctcae_selection_accuracy: metricsSummary.ctcae_selection_accuracy,
    protocol_selection_accuracy: metricsSummary.protocol_selection_accuracy,
    grounding_score_avg: humanReviewSummary?.averages?.grounding_score_avg ?? '',
    safety_score_avg: humanReviewSummary?.averages?.safety_score_avg ?? '',
    actionability_score_avg: humanReviewSummary?.averages?.actionability_score_avg ?? '',
    clarity_score_avg: humanReviewSummary?.averages?.clarity_score_avg ?? '',
    avg_latency_ms: metricsSummary.avg_latency_ms,
    p95_latency_ms: metricsSummary.p95_latency_ms,
    avg_cost: metricsSummary.avg_cost,
    citation_rate: metricsSummary.citation_rate,
    high_risk_case_success_rate: metricsSummary.high_risk_case_success_rate,
  };
}

function buildCaseComparisonRows(manifest, caseResults, humanReviewRows = []) {
  const reviewByCaseId = new Map(
    humanReviewRows.map((row) => [`${normalizeText(row.case_id)}::${normalizeText(row.combo_id)}`, row])
  );

  return caseResults.map((result) => {
    const review = reviewByCaseId.get(`${normalizeText(result.case_id)}::${normalizeText(manifest.combo_id)}`) || {};
    return {
      combo_id: manifest.combo_id,
      case_id: result.case_id,
      scenario_id: result.scenario_id,
      question_type: result.question_type,
      risk_level: result.risk_level,
      route_decision: result.route_decision,
      route_reason: result.route_reason,
      route_correct: result.route_decision === result.expected_route_decision ? 'true' : 'false',
      grounding_score: review.grounding_score || '',
      safety_score: review.safety_score || '',
      actionability_score: review.actionability_score || '',
      clarity_score: review.clarity_score || '',
      overall_pass_fail: review.overall_pass_fail || '',
      total_latency_ms: result.total_latency_ms,
      estimated_cost: result.estimated_cost,
      status: result.status,
      error: result.error,
    };
  });
}

async function main() {
  const inputDir = resolve(process.cwd(), getArg('--input-dir', './output/evals'));
  const outDir = resolve(process.cwd(), getArg('--out-dir', './output/evals/summary'));
  const runDirs = await collectRunDirectories(inputDir);

  const comboBundles = [];
  for (const runDir of runDirs) {
    const manifestPath = join(runDir, 'run_manifest.json');
    const metricsPath = join(runDir, 'metrics_summary.json');
    const resultsPath = join(runDir, 'case_results.json');

    if (!(await pathExists(manifestPath)) || !(await pathExists(metricsPath)) || !(await pathExists(resultsPath))) {
      continue;
    }

    const [manifest, metricsSummary, caseResults, humanReviewSummary] = await Promise.all([
      readJson(manifestPath),
      readJson(metricsPath),
      readJson(resultsPath),
      readHumanReviewSummary(runDir),
    ]);

    comboBundles.push({
      run_dir: runDir,
      manifest,
      metrics_summary: metricsSummary,
      case_results: caseResults,
      human_review: humanReviewSummary,
    });
  }

  if (!comboBundles.length) {
    throw new Error(`No completed guidance eval runs were found in ${inputDir}.`);
  }

  const leaderboardRows = comboBundles.map((bundle) =>
    buildLeaderboardRow(bundle.manifest, bundle.metrics_summary, bundle.human_review)
  );
  const caseComparisonRows = comboBundles.flatMap((bundle) =>
    buildCaseComparisonRows(bundle.manifest, bundle.case_results, bundle.human_review.rows)
  );

  const reportBundle = {
    generated_at: new Date().toISOString(),
    input_dir: inputDir,
    combos: comboBundles.map((bundle) => ({
      combo_id: bundle.manifest.combo_id,
      run_dir: bundle.run_dir,
      manifest: bundle.manifest,
      metrics_summary: bundle.metrics_summary,
      human_review_averages: bundle.human_review.averages,
      representative_failures: bundle.case_results
        .filter((result) => result.status === 'error' || result.route_decision !== result.expected_route_decision)
        .slice(0, 5),
      representative_successes: bundle.case_results
        .filter((result) => result.status === 'success' && result.route_decision === result.expected_route_decision)
        .slice(0, 5),
    })),
  };

  const leaderboardColumns = [
    'combo_id',
    'router_profile_id',
    'router_provider',
    'router_model',
    'answer_profile_id',
    'answer_provider',
    'answer_model',
    'success_rate',
    'route_accuracy',
    'skip_accuracy',
    'ctcae_selection_accuracy',
    'protocol_selection_accuracy',
    'grounding_score_avg',
    'safety_score_avg',
    'actionability_score_avg',
    'clarity_score_avg',
    'avg_latency_ms',
    'p95_latency_ms',
    'avg_cost',
    'citation_rate',
    'high_risk_case_success_rate',
  ];

  const caseComparisonColumns = [
    'combo_id',
    'case_id',
    'scenario_id',
    'question_type',
    'risk_level',
    'route_decision',
    'route_reason',
    'route_correct',
    'grounding_score',
    'safety_score',
    'actionability_score',
    'clarity_score',
    'overall_pass_fail',
    'total_latency_ms',
    'estimated_cost',
    'status',
    'error',
  ];

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(outDir, 'leaderboard.csv'), `${stringifyCsv(leaderboardRows, leaderboardColumns)}\n`, 'utf8'),
    writeFile(
      resolve(outDir, 'case_comparison.csv'),
      `${stringifyCsv(caseComparisonRows, caseComparisonColumns)}\n`,
      'utf8'
    ),
    writeFile(resolve(outDir, 'report_bundle.json'), `${JSON.stringify(reportBundle, null, 2)}\n`, 'utf8'),
  ]);

  console.log(
    JSON.stringify(
      {
        outDir,
        combos: comboBundles.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
