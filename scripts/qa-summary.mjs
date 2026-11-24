import { readFileSync,writeFileSync } from "node:fs";
const read=path=>JSON.parse(readFileSync(path,"utf8").replace(/^\uFEFF/,""));
const acceptance=read("qa-artifacts/verified-audit/results.json"),regression=read("qa-artifacts/regression-results.json"),unit=read("qa-artifacts/unit-results.json");
const before=read("qa-artifacts/shop-data-before.json"),after=read("qa-artifacts/shop-data-after.json"),audit=read("qa-artifacts/dependency-audit.json");
const specs=suites=>suites.flatMap(s=>[...(s.specs||[]),...specs(s.suites||[])]);
const features=specs(acceptance.suites).map(s=>({feature:s.title,status:s.tests.every(t=>t.results.at(-1)?.status==="passed")?"PASS":"FAIL",checks:s.tests.reduce((n,t)=>n+(t.results.at(-1)?.steps?.length||0),0)}));
const summary={date:"2026-11-22",applicationVersion:read("package.json").version,
  databaseTests:{passed:unit.numPassedTests,failed:unit.numFailedTests,total:unit.numTotalTests},
  browserTests:{acceptancePassed:acceptance.stats.expected,regressionPassed:regression.stats.expected,failed:acceptance.stats.unexpected+regression.stats.unexpected,skipped:acceptance.stats.skipped+regression.stats.skipped},features,
  fixes:["Purchase cancellation now restores the valid purchase-cost reference, preserving explicit manual corrections.","CSV export escapes spreadsheet-like cells without deleting original characters.","Inventory uses the saved shop name consistently with the other screens."],
  harnessCorrections:["Installed the missing video recorder.","Scoped error-message assertions to the main content, excluding Next.js's separate route announcer."],
  codeChecks:{lint:"PASS",typecheck:"PASS",productionBuild:"PASS"},shopRecordsUnchanged:before.hash===after.hash,
  dependencyFindings:audit.metadata.vulnerabilities,
  stillRequired:["Review the seven moderate lint/development dependency findings before release.","Test the actual A4 printer and per-user installation on the shop computer.","Remote GitHub CI/CD and hosted-demo acceptance have not run."],
  evidence:{interactiveReport:"http://127.0.0.1:3210",recordedAcceptance:"qa-artifacts/verified-audit/report/index.html",originalFindings:"qa-artifacts/observed-audit/results.json",databaseChecks:"qa-artifacts/unit-results.json"}};
writeFileSync("qa-artifacts/audit-summary.json",JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
