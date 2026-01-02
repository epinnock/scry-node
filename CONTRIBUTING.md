# Contributing to @scrymore/scry-deployer

Thank you for your interest in contributing! This document outlines the process for contributing to this project.

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/epinnock/scry-node.git
   cd scry-node
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Run the CLI locally**
   ```bash
   node bin/cli.js --help
   ```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-new-command` - New features
- `fix/screenshot-timeout` - Bug fixes
- `docs/update-readme` - Documentation updates
- `chore/update-deps` - Maintenance tasks

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new screenshot comparison feature
fix: resolve timeout issue in large storybooks
docs: update installation instructions
chore: update dependencies
```

## Release Process

This project uses [Changesets](https://github.com/changesets/changesets) for version management and releases.

### Creating a Changeset

When you make changes that should be released, create a changeset:

```bash
pnpm changeset
```

You'll be prompted to:
1. Select the package(s) affected
2. Choose the version bump type:
   - **patch** (1.0.0 → 1.0.1): Bug fixes, minor changes
   - **minor** (1.0.0 → 1.1.0): New features, backwards compatible
   - **major** (1.0.0 → 2.0.0): Breaking changes
3. Write a summary of your changes

This creates a markdown file in `.changeset/` that should be committed with your PR.

### Example Changeset

```markdown
---
"@scrymore/scry-deployer": minor
---

Added new `--compare` flag for screenshot comparison between deployments
```

### Release Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Developer Workflow                        │
├─────────────────────────────────────────────────────────────────┤
│  1. Make changes to code                                        │
│  2. Run `pnpm changeset` to create a changeset                  │
│  3. Commit changes + changeset file                             │
│  4. Open Pull Request                                           │
│  5. PR is reviewed and merged to main                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Automated Release                           │
├─────────────────────────────────────────────────────────────────┤
│  1. Release workflow detects changesets                         │
│  2. Creates "Version Packages" PR with:                         │
│     - Updated version in package.json                           │
│     - Updated CHANGELOG.md                                      │
│  3. When Version PR is merged:                                  │
│     - Package is published to npm                               │
│     - GitHub Release is created                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Nightly Releases

Nightly releases are automatically published every day at midnight UTC if there are changes since the last release.

Install nightly versions:
```bash
npm install @scrymore/scry-deployer@nightly
```

You can also manually trigger a nightly release from the GitHub Actions tab.

## Pull Request Guidelines

1. **Create a changeset** if your changes should be released
2. **Update documentation** if you're changing behavior
3. **Add tests** for new features (when test infrastructure is available)
4. **Keep PRs focused** - one feature/fix per PR
5. **Write clear descriptions** explaining what and why

### PR Checklist

- [ ] Created a changeset (if applicable)
- [ ] Updated relevant documentation
- [ ] Tested changes locally
- [ ] Followed commit message conventions

## Code Style

- Use CommonJS (`require`/`module.exports`) as specified in package.json
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small

## Questions?

If you have questions about contributing, feel free to open an issue for discussion.
