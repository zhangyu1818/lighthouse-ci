import fs from 'fs/promises';
import lighthouse from 'lighthouse';
import * as constants from 'lighthouse/core/config/constants.js';
import * as chromeLauncher from 'chrome-launcher';
import process from 'process';
import path from 'path';

async function runLighthouse(url, device) {
  const isMobile = device === 'mobile';
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
  const runnerResult = await lighthouse(
    url,
    {
      port: chrome.port,
    },
    {
      extends: 'lighthouse:default',
      settings: {
        formFactor: device,
        throttling: constants.throttling[isMobile ? 'mobileSlow4G' : 'desktopDense4G'],
        screenEmulation: constants.screenEmulationMetrics[device],
        emulatedUserAgent: constants.userAgents[device],
        output: ['html', 'json'],
      },
    }
  );
  await chrome.kill();
  return runnerResult; // return the entire runnerResult object
}

async function readUrlsFromFile(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

function getLocalDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0'); // 月份是从0开始的
  const day = now.getDate().toString().padStart(2, '0');
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

async function saveResult(timestamp, runnerResult, url, country, device) {
  const dir = path.join('results', country, timestamp, device);
  await fs.mkdir(dir, { recursive: true });

  const fileNameBase = url.replace(/https?:\/\//, '').replace(/\//g, '_');
  const jsonFilePath = path.join(dir, `${fileNameBase}.json`);
  const htmlFilePath = path.join(dir, `${fileNameBase}.html`);

  await fs.writeFile(jsonFilePath, JSON.stringify(runnerResult.lhr, null, 2));
  await fs.writeFile(htmlFilePath, runnerResult.report[0]);

  return jsonFilePath;
}

function calculateScoreDifferences(previousResult, currentResult) {
  const categories = Object.keys(currentResult.categories);
  const scoreDifferences = categories.map(categoryId => {
    const categoryTitle = currentResult.categories[categoryId].title;
    const previousScore = (previousResult.categories[categoryId].score || 0) * 100;
    const currentScore = (currentResult.categories[categoryId].score || 0) * 100;
    const difference = currentScore - previousScore;
    return {
      Category: categoryTitle,
      'Previous Score': previousScore.toFixed(2),
      'Current Score': currentScore.toFixed(2),
      Difference: difference.toFixed(2),
    };
  });
  return scoreDifferences;
}

async function getPreviousResult(url, currentFilePath, country, device) {
  const dir = path.dirname(currentFilePath);
  const timestampDir = path.dirname(dir);
  const countryDir = path.dirname(timestampDir);
  const folders = await fs.readdir(countryDir, { withFileTypes: true });
  const timestampDirs = folders
    .filter(dirent => dirent.isDirectory())
    .map(dirent => ({ name: dirent.name, path: path.join(countryDir, dirent.name) }));

  const statsPromises = timestampDirs.map(dirStat =>
    fs.stat(dirStat.path).then(stat => ({ ...dirStat, mtime: stat.mtime }))
  );
  const stats = await Promise.all(statsPromises);
  stats.sort((a, b) => b.mtime - a.mtime);

  const previousTimestampDir = stats[1] ? stats[1].path : null;
  if (!previousTimestampDir) return null;

  const deviceDir = path.join(previousTimestampDir, device);
  const fileName = url.replace(/https?:\/\//, '').replace(/\//g, '_') + '.json';
  const previousFilePath = path.join(deviceDir, fileName);
  try {
    return await fs.readFile(previousFilePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function generateHTMLTable(urlScoreDifferences, device) {
  let tableHtml = `<h2>${device.toUpperCase()} - URL: ${urlScoreDifferences.url}</h2>`;
  tableHtml += `<table border="1"><tr><th>Category</th><th>Previous Score</th><th>Current Score</th><th>Difference</th></tr>`;

  for (const scoreDiff of urlScoreDifferences.scoreDifferences) {
    tableHtml += `<tr>
                    <td>${scoreDiff.Category}</td>
                    <td>${scoreDiff['Previous Score']}</td>
                    <td>${scoreDiff['Current Score']}</td>
                    <td>${scoreDiff.Difference}</td>
                  </tr>`;
  }

  tableHtml += `</table>`;
  return tableHtml;
}

async function main() {
  const urlsObject = await readUrlsFromFile('urls.json');
  const allScoreDifferences = {};

  const args = process.argv.slice(2);
  const countriesToRun = args.map(arg => arg.replace('--', ''));
  const countries = countriesToRun.length ? countriesToRun : Object.keys(urlsObject);

  const timestamp = getLocalDateTime();

  for (const country of countries) {
    if (!urlsObject.hasOwnProperty(country)) {
      console.error(`No URLs configured for country: ${country}`);
      continue;
    }

    allScoreDifferences[country] = [];
    const urls = urlsObject[country];

    for (const url of urls) {
      for (const device of ['mobile', 'desktop']) {
        console.log(`Running Lighthouse for ${url} in ${country} on ${device}`);
        const result = await runLighthouse(url, device);
        const currentFilePath = await saveResult(timestamp, result, url, country, device);

        const previousResultData = await getPreviousResult(url, currentFilePath, country, device);
        if (previousResultData) {
          const previousResult = JSON.parse(previousResultData);
          const scoreDifferences = calculateScoreDifferences(previousResult, result.lhr);
          allScoreDifferences[country].push({
            url,
            device,
            scoreDifferences,
          });
        }
      }
    }
  }

  let hasDifferences = false;

  for (const country of Object.keys(allScoreDifferences)) {
    if (allScoreDifferences[country].length > 0) {
      console.log(`Score differences for ${country}:`);
      for (const urlScoreDifferences of allScoreDifferences[country]) {
        console.log(`URL: ${urlScoreDifferences.url} on ${urlScoreDifferences.device}`);
        console.table(urlScoreDifferences.scoreDifferences);
      }
      hasDifferences = true;
    }
  }

  if (hasDifferences) {
    let finalHtml = `<html><head><title>Lighthouse Score Differences</title></head><body>`;
    finalHtml += `<h1>Lighthouse Score Differences</h1>`;

    for (const country of Object.keys(allScoreDifferences)) {
      if (allScoreDifferences[country].length > 0) {
        finalHtml += `<h2>Country: ${country}</h2>`;
        for (const urlScoreDifferences of allScoreDifferences[country]) {
          finalHtml += generateHTMLTable(urlScoreDifferences, urlScoreDifferences.device);
        }
      }
    }

    finalHtml += `</body></html>`;

    const timestamp = getLocalDateTime();
    const summaryDirPath = path.join('results', 'summary');
    await fs.mkdir(summaryDirPath, { recursive: true });

    const summaryFilePath = path.join(summaryDirPath, `summary-${timestamp}.html`);
    await fs.writeFile(summaryFilePath, finalHtml);

    console.log(`Summary HTML has been saved to ${summaryFilePath}`);
  } else {
    console.log('No score differences to report.');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
