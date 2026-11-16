# GitHub Tab Groups

A Chrome extension that keeps your GitHub pull requests and issues in tab groups.

- **GitHub PRs** holds the open PRs you wrote or are assigned to.
- **GitHub Issues** holds the open issues assigned to you.

Opening a PR or issue that's already in a group switches to that tab instead of opening a second one. The groups stay at the front of the tab strip, right after your pinned tabs. When a new PR or issue is assigned to you, it opens in its group in the background.

## Install

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repo folder.
4. Paste a GitHub token on the page that opens.

## Token

The extension uses the GitHub API to find your PRs and issues, so it needs a token. [Create a classic token](https://github.com/settings/tokens/new?description=GitHub%20Tab%20Groups&scopes=repo) with the `repo` scope. If your organization uses SSO, authorize the token for it.

The token stays in your browser and is only sent to `api.github.com`. If it stops working, the extension icon shows a red **!**. Click it to connect again.

## Customize

The groups are defined at the top of [`background.js`](background.js). Each one takes any [GitHub search query](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests), for example `is:pr is:open review-requested:@me`.

## License

[MIT](LICENSE)
