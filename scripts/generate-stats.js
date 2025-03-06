import fetch from "node-fetch";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import fs from "fs";

// Extensão de timezones do dayjs
dayjs.extend(utc);
dayjs.extend(timezone);

// Lê o token da env MY_PERSONAL_TOKEN
// const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_TOKEN = process.env.MY_PERSONAL_TOKEN || "";

// Ajuste para sua timezone preferida
const TIMEZONE = "America/Sao_Paulo";

// Se quiser ignorar forks ou repos arquivados
const IGNORAR_FORKS = false;
const IGNORAR_ARCHIVED = false;

// Arrays para contar por hora (0..23)
const commitBins = Array.from({ length: 24 }, () => 0);
const issueBins = Array.from({ length: 24 }, () => 0);
const prBins = Array.from({ length: 24 }, () => 0);

/** Função auxiliar para paginação da API do GitHub */
async function fetchAll(urlBase) {
  let page = 1;
  let allItems = [];

  while (true) {
    const url = `${urlBase}&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    });

    if (!res.ok) {
      console.error("Erro:", res.status, await res.text());
      break;
    }

    const data = await res.json();
    if (data.length === 0) break;

    allItems = allItems.concat(data);
    page++;
  }

  return allItems;
}

/** Busca todos os repositórios do usuário (owner, collaborator, org_member) */
async function fetchAllRepos() {
  const baseUrl = `https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc`;
  const repos = await fetchAll(baseUrl);

  let filtered = repos;
  if (IGNORAR_FORKS) {
    filtered = filtered.filter((r) => !r.fork);
  }
  if (IGNORAR_ARCHIVED) {
    filtered = filtered.filter((r) => !r.archived);
  }
  return filtered;
}

/** Commits dos últimos 30 dias */
async function fetchCommits(owner, repo) {
  const since = dayjs().subtract(30, "day").toISOString();
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/commits?since=${since}`;
  return fetchAll(baseUrl);
}

/** Issues (abertas/fechadas) dos últimos 30 dias */
async function fetchIssues(owner, repo) {
  const since = dayjs().subtract(30, "day").toISOString();
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/issues?since=${since}&state=all`;
  return fetchAll(baseUrl);
}

/** PRs (abertas/fechadas/mergeadas) sem since, mas pode adaptar */
async function fetchPRs(owner, repo) {
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc`;
  return fetchAll(baseUrl);
}

function processCommits(commits) {
  for (const c of commits) {
    const dateStr = c.commit.author.date;
    const hour = dayjs.utc(dateStr).tz(TIMEZONE).hour();
    commitBins[hour]++;
  }
}

function processIssues(issues) {
  for (const issue of issues) {
    const dateStr = issue.created_at;
    const hour = dayjs.utc(dateStr).tz(TIMEZONE).hour();
    issueBins[hour]++;
  }
}

function processPRs(prs) {
  for (const pr of prs) {
    const dateStr = pr.created_at;
    const hour = dayjs.utc(dateStr).tz(TIMEZONE).hour();
    prBins[hour]++;
  }
}

/** Gera um gráfico com QuickChart.io e salva em gh-stats.png */
async function generateChart() {
  const labels = Array.from({ length: 24 }, (_, i) => `${i}h`);

  const chartConfig = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Commits",
          data: commitBins,
          borderColor: "#36A2EB",
          backgroundColor: "rgba(54,162,235,0.2)",
          fill: true,
        },
        {
          label: "Issues",
          data: issueBins,
          borderColor: "#F97316",
          backgroundColor: "rgba(249,115,22,0.2)",
          fill: true,
        },
        {
          label: "PRs",
          data: prBins,
          borderColor: "#10B981",
          backgroundColor: "rgba(16,185,129,0.2)",
          fill: true,
        },
      ],
    },
    options: {
      scales: {
        x: { ticks: { color: "#fff" } },
        y: { ticks: { color: "#fff" } },
      },
      plugins: {
        legend: { labels: { color: "#fff" } },
      },
      backgroundColor: "#1f2937"
    },
  };

  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      width: 800,
      height: 400,
      format: "png",
      chart: chartConfig,
      backgroundColor: "#1f2937",
    }),
  });

  if (!res.ok) {
    console.error("Erro ao gerar chart:", res.status, await res.text());
    return;
  }

  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync("gh-stats.png", Buffer.from(arrayBuffer), "binary");
  console.log("Gerado gh-stats.png com sucesso!");
}

async function main() {
  if (!GITHUB_TOKEN) {
    console.error("Token não encontrado! Configure a secret MY_PERSONAL_TOKEN.");
    process.exit(1);
  }

  const repos = await fetchAllRepos();
  console.log(`Total de repositórios após filtro: ${repos.length}`);

  for (const repo of repos) {
    const { owner, name } = repo;
    console.log(`Processando: ${owner.login}/${name}`);

    const commits = await fetchCommits(owner.login, name);
    processCommits(commits);

    const issues = await fetchIssues(owner.login, name);
    processIssues(issues);

    const prs = await fetchPRs(owner.login, name);
    processPRs(prs);
  }

  await generateChart();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
