import * as core from "@actions/core";
import * as github from "@actions/github";
import { Config, validateConfig } from "./models/config";
import {
  getChangedFiles,
  getConfigApprovers,
  getConfigReviewers,
  loadYaml,
} from "./utils";
import {
  IssueCommentEvent,
  PullRequestEvent,
} from "@octokit/webhooks-definitions/schema";

const githubApi = github.getOctokit(
  core.getInput("repo-token", { required: true })
);

const ownerFilePath = core.getInput("config-file", { required: true });

async function run(): Promise<void> {
  const eventName = github.context.eventName;
  console.debug(`Handling ${eventName}`);
  switch (eventName) {
    case "pull_request":
    case "pull_request_target":
      return handlePullRequest();
    case "issue_comment":
      return handleIssueComment();
  }
}

async function handlePullRequest() {
  const event = github.context.payload as PullRequestEvent;
  const pull = event.pull_request;
  const labels = pull.labels.map((label) => label.name);

  if (labels.includes("needs lgtm") || labels.includes("needs approve")) {
    // TODO(anuraaga): Consider resyncing reviewers on every event, not just creation.
    console.debug('Already contains label.');
    return;
  }

  const config = await getConfig(pull.base.sha);
  const changedFiles = await getChangedFiles(
    githubApi,
    pull.base.sha,
    pull.head.sha
  );
  const reviewers = await getConfigReviewers(config, changedFiles);
  console.debug(`Adding reviewers ${reviewers}`);

  const reviewComment = `Requesting review from: ${reviewers.map(name => `@${name}`).join(' ')}`;

  await githubApi.rest.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: pull.number,
    body: reviewComment,
  });

  await githubApi.rest.issues.addLabels({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: pull.number,
    labels: ["needs lgtm"],
  });
}

async function handleIssueComment() {
  const event = github.context.payload as IssueCommentEvent;
  if (!event.issue.pull_request) {
    return;
  }

  const pullRes = await githubApi.rest.pulls.get({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: event.issue.number,
  });
  const pull = pullRes.data;

  const labels = pull.labels.map((label) => label.name);

  var needsLgtm = false;
  if (labels.includes("needs lgtm")) {
    needsLgtm = true;
    if (!event.comment.body.includes("/lgtm")) {
      return;
    }
  }

  var needsApprove = false;
  if (labels.includes("needs approve")) {
    needsApprove = true;
    if (!event.comment.body.includes("/approve")) {
      return;
    }
  }

  const config = await getConfig(pull.base.sha);
  const changedFiles = await getChangedFiles(
    githubApi,
    pull.base.sha,
    pull.head.sha
  );
  const approvers = await getConfigApprovers(config, changedFiles);
  const commenter = event.comment.user.login;

  if (needsLgtm) {
    const reviewers = await getConfigReviewers(config, changedFiles);

    if (!reviewers.includes(commenter)) {
      core.debug(`/lgtm from non-reviewer ${commenter}`);
      return;
    }

    const reviewComment = `Requesting approval from: ${approvers.map(name => `@${name}`).join(' ')}`;

    await githubApi.rest.issues.createComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: pull.number,
      body: reviewComment,
    });

    await githubApi.rest.issues.addLabels({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: event.issue.number,
      labels: ["needs approve"],
    });

    await githubApi.rest.issues.removeLabel({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: event.issue.number,
      name: "needs lgtm",
    });
  } else if (needsApprove) {
    if (!approvers.includes(commenter)) {
      core.debug(`/approve from non-reviewer ${commenter}`);
      return;
    }

    await githubApi.rest.issues.addLabels({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: event.issue.number,
      labels: ["ready for merge"],
    });

    await githubApi.rest.issues.removeLabel({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: event.issue.number,
      name: "needs approve",
    });
  }
}

async function getConfig(ref: string): Promise<Config> {
  const configFile = await loadYaml(githubApi, ref, ownerFilePath);
  return validateConfig(configFile);
}

run();
