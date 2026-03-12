const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// JSON 데이터 읽기
const dataPath = path.join(process.cwd(), "data", "future_job_3960.json");
const jobs = JSON.parse(fs.readFileSync(dataPath, "utf8"));

// 추천 API
app.post("/recommend", (req, res) => {
  const { country, period, grade } = req.body;

  const result = jobs.filter(
    j =>
      j["국가"] === country &&
      j["시기"] === period &&
      j["직업등급"] === grade
  );

  res.json(result);
});

module.exports = app;