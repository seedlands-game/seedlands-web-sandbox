import { readFileSync } from 'node:fs';

const reportPath = process.argv[2] ?? 'lighthouse-report.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const minimumScore = 0.9;
const categories = ['performance', 'best-practices', 'accessibility', 'seo'];
const failures = [];

for (const category of categories) {
  const score = report.categories?.[category]?.score;
  console.log(`Lighthouse ${category}: ${typeof score === 'number' ? Math.round(score * 100) : 'NOT_COLLECTED'}`);
  if (typeof score !== 'number' || score < minimumScore) failures.push(category);
}

if (failures.length) throw new Error(`Lighthouse 未达到 90 分门禁：${failures.join(', ')}`);
