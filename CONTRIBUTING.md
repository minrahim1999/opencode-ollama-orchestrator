# Contributing

Thank you for considering contributing to opencode-ollama-orchestrator!

## Development Setup

```bash
git clone git@github.com:minrahim1999/opencode-ollama-orchestrator.git
cd opencode-ollama-orchestrator
npm install
npm run build
```

## Project Structure

```
src/
├── agents/          # Agent role definitions and prompts
├── commands/        # Slash command registrations
├── core/            # Config handler, event handler, mission loop
├── tools/           # Custom tools exposed to agents
├── utils/           # Helper utilities (provider lock, etc.)
└── types.ts         # Shared TypeScript types
```

## Making Changes

1. Fork and create a feature branch: `git checkout -b feature/my-feature`
2. Make changes with clear commit messages
3. Ensure `npm run build` succeeds
4. Test against a real OpenCode instance with Ollama running
5. Submit a pull request

## Code Style

- TypeScript strict mode enabled
- Use ESM modules (`import/export`)
- Prefer early returns over nested conditionals
- Comment complex orchestration logic

## Reporting Issues

Please use the GitHub issue templates provided.
