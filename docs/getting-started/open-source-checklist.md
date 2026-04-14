# Open Source Readiness Checklist

Use this checklist before making a repository public under the **THD-Spatial** group.

---

## Review Summary

| Section | Requirement Level | Status | Notes |
| ------- | ----------------- | ------ | ----- |
| [Essential Requirements](#essential-requirements) | Required | **Complete** | LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT all present |
| [Data Management (Git LFS)](#data-management) | Required if applicable | **Complete** | `.gitattributes` configured for large files |
| [Attribution](#attribution) | Required if applicable | **Complete** | `ATTRIBUTIONS.md` covers all libraries and data sources |
| [Citation](#citation) | Recommended | **Complete** | `CITATION.cff` present with PyLovo paper reference |
| [Optional but Recommended Files](#optional-but-recommended-files) | Recommended | Pending | CHANGELOG, issue templates, SECURITY.md not yet added |
| [Quality Checks](#quality-checks) | Required | **Complete** | Docs migrated to MkDocs, sensitive data excluded |
| [Final Steps](#final-steps) | Required | Pending | Verify fresh clone and confirm public visibility settings |

---

## Essential Requirements

### LICENSE

- [x] `LICENSE` file present in repository root
- [x] MIT license selected
- [x] License text is correct and complete
- [x] License committed to repository

### README

- [x] `README.md` file present in repository root
- [x] Project title and short description included
- [x] Project purpose clearly explained
- [x] Key features listed
- [x] Installation/setup instructions provided (links to full docs)
- [x] Usage examples or usage steps included
- [x] Contribution guidance referenced (`CONTRIBUTING.md`)
- [x] README uses clear Markdown formatting

### CONTRIBUTING

- [x] `CONTRIBUTING.md` file present in repository root
- [x] Issue reporting process documented
- [x] Pull request submission process documented
- [x] Coding standards / best practices outlined
- [x] Commit message guidance included
- [x] `CONTRIBUTING.md` linked from `README.md`

### CODE_OF_CONDUCT

- [x] `CODE_OF_CONDUCT.md` file present in repository root
- [x] Contributor Covenant 2.1 adopted
- [x] Contact method for reporting issues included
- [x] `CODE_OF_CONDUCT.md` linked from `CONTRIBUTING.md`

!!! success "Essential requirements complete"
    All four essential files are present and properly linked.

---

## Data Management

Git LFS is required for repositories containing large binary or geospatial files.

### Git LFS

- [x] `.gitattributes` committed to repository root
- [x] Large file types tracked: `.7z`, `.zip`, `.tar.gz`, `.shp`, `.gpkg`, `.geojson`
- [x] Image assets tracked: `.png`, `.jpg`, `.svg`, `.gif`, `.webp`
- [x] Other binaries tracked: `.parquet`, `.sql.gz`, `.wasm`
- [ ] Git LFS enabled on the hosting repository (enable in GitHub repository settings)
- [ ] Existing large files migrated with `git lfs migrate import` if added before LFS was configured
- [ ] **Enable "Include Git LFS objects in archives"** in repository Settings → General → Archives

!!! note
    Run `git lfs install` locally and `git lfs pull` after cloning to fetch tracked files.

---

## Attribution

- [x] `ATTRIBUTIONS.md` file present in repository root
- [x] All frontend libraries listed with license types (React, OpenLayers, MapLibre, etc.)
- [x] All backend libraries listed (Gin, GORM, Asynq, etc.)
- [x] Infrastructure components listed (PostgreSQL/PostGIS, Keycloak, Redis, Nginx)
- [x] PyLovo dependencies listed (Calliope, PyPSA, PySAM, Pandapower)
- [x] Open data sources listed (OpenStreetMap, 3D BAG, CBS, EP-Online, GADM)
- [x] Research citation included (Reveron Baecker et al. 2025)

---

## Citation

- [x] `CITATION.cff` file present in repository root
- [x] `cff-version: 1.2.0`
- [x] Project title and description specified
- [x] Authors listed with affiliation
- [x] License field matches `LICENSE` file (MIT)
- [x] Repository URL included
- [x] Version and release date set
- [ ] Validate against CFF schema using [cff-validator](https://github.com/citation-file-format/cff-initializer-javascript)

---

## Optional but Recommended Files

### CHANGELOG

- [ ] `CHANGELOG.md` created
- [ ] Version history documented
- [ ] Formatted consistently (e.g. [Keep a Changelog](https://keepachangelog.com/))

### Issue and PR Templates

- [ ] `.github/ISSUE_TEMPLATE/` directory with bug report and feature request templates
- [ ] `.github/pull_request_template.md` with contributor checklist

### Security Policy

- [ ] `SECURITY.md` created with vulnerability reporting process and contact

### Support Guidelines

- [ ] `SUPPORT.md` created with support channels and response expectations

---

## Quality Checks

### Documentation

- [x] Sphinx/RST documentation replaced with MkDocs Material
- [x] Mermaid diagrams used in place of inline HTML
- [x] `mkdocs.yml` present in repository root
- [x] All inline HTML removed from docs
- [x] Documentation reviewed for clarity and accuracy
- [ ] All links in documentation verified as working
- [ ] Code examples and commands tested

### Repository Settings

- [ ] Repository description added on GitHub
- [ ] Topics/tags added: `energy-planning`, `grid-generation`, `geospatial`, `calliope`, `pylovo`, `openstreetmap`
- [ ] Repository visibility set to **Public**
- [ ] Default branch set to `main`
- [ ] Branch protection rules configured for `main`
- [ ] **"Include Git LFS objects in archives"** enabled in Settings

### Code Quality / Safety

- [x] `.gitignore` configured (node_modules, .env, dist, build, site, etc.)
- [x] `.gitattributes` configured for Git LFS
- [ ] Repository scanned for secrets and credentials (run `git log --all -- '*.env*'` and inspect)
- [x] Default credentials in documentation noted as development-only
- [x] Dependencies documented in `ATTRIBUTIONS.md`
- [x] Build/setup instructions included (`make setup`, backend/frontend start commands)

---

## Final Steps

- [ ] All essential requirements completed — **Done** (see above)
- [ ] Repository cloned fresh into a clean directory and `make setup` verified end-to-end
- [ ] All documentation links resolve correctly
- [ ] CI/CD pipeline (`.gitlab-ci.yml`) reviewed — remove or adapt for GitHub Actions if needed
- [ ] Internal hostnames removed from docs
- [ ] Team members notified about repository availability

---

## Repository Ready for Open Source

Once all required items are completed and final steps verified:

- **Date completed:** `13.04.2026`
- **Reviewed by:** [`Jay Ravani`](https://github.com/jravani), [`Stefan Kern`](https://github.com/blackwolf244)

---

## Need Help?

- Ask the THD-Spatial-AI [maintainers](https://github.com/orgs/THD-Spatial-AI/people)
