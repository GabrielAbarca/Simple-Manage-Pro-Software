---
name: split-monolith
description: Professionally analyze, break down, and modularize giant monolithic source files into clean, maintainable micro-modules.
argument-hint: [path/to/large/file]
allowed-tools: [Read, Write, Grep]
---

# Monolith Decomposition Skill

You are a Principal Software Architect. Your job is to take the provided massive source file and systematically break it into small, clean, testable modules adhering to strict SOLID principles and clean code practices.

## Phase 1: Dependency Mapping & Blueprint (MANDATORY)

1. Read the entire target file. **Do not modify anything yet.**
2. Map all internal dependencies. Identify:
   - Shared utility/helper functions.
   - Core state management or global variables.
   - Distinct business domains or logic boundaries (e.g., Data Parsing, API Handlers, UI Logic).
3. Present a written **Modular Architecture Blueprint** to the user. Group the code into proposed new file paths.
4. Stop and ask for explicit user approval before proceeding.

## Phase 2: Incremental Extraction & Verification

Once approved, extract modules one by one. For each module:

1. Isolate the functions/classes into their own new file.
2. Ensure simple, clean signatures. Replace deep nesting with early guard clauses.
3. Import the new module back into the original monolith file to preserve public API signatures.
4. Run the project's build or test commands (`/verify`) to ensure no behavioral regression occurred.
5. Create an atomic Git commit for each successfully extracted file.

## Quality Standards

- No file should exceed 300 lines of code post-split.
- Maximize simplicity; clear code over "clever" abstractions.
- Keep variables scoped locally; eliminate shared global file state where possible.
