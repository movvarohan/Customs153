# Project: AI-Native Customs Brokerage MVP

## What we're building
An AI agent that ingests shipping documents (commercial invoice, packing list, bill of lading) for SMB importers, classifies line items to 10-digit HTS codes with cited GRI reasoning and CBP CROSS rulings, calculates duties (including Section 301/232/reciprocal), and produces a draft entry summary for licensed broker review.

## Stack
- Cloudflare Workers (TypeScript) for backend
- Cloudflare Pages + Next.js for frontend
- D1 for relational data
- R2 for document storage
- Vectorize for HTS schedule and CROSS ruling embeddings
- Workflows for multi-step shipment lifecycle
- Anthropic API (Claude Sonnet 4.5 for classification reasoning, Haiku for cheap tasks)
- Workers AI for embeddings only

## Conventions
- TypeScript strict mode
- All external IO through typed interfaces
- Every HTS classification must cite at least one source (HTS paragraph or CBP ruling)
- Eval harness against CROSS rulings is a first-class output, not an afterthought

## Out of scope for MVP
- Direct ACE/ABI filing (we hand off to a partner broker)
- Multi-country (US imports only)
- Real-time tariff API (we hardcode 2026 rates and update manually)
