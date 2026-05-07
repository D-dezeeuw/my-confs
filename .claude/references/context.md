# Conference Talk Picker
Help me build a personalized session plan for **[CONFERENCE NAME]** on **[DAY / DATE]**.
## Schedule source
[Paste URL, or "see pasted text below"]
If the URL is a JS-heavy SPA (Zoho Backstage, Sched, Whova, conference mobile apps, etc.) and `web_fetch` returns only the page shell, **stop and ask me to select-all + copy-paste the schedule text**. Don't guess sessions or invent a schedule. Don't ask for screenshots — agendas overflow viewport height and you'll only get the top.
## My profile
<!-- Either fill this in, OR leave the section empty and let yourself be interviewed.
Example:
- Role: Solo full-stack dev + AI consultant
- Stack: SvelteKit, Supabase (self-hosted), PostGIS, Bun
- Wrong-fit: React Native, Spring/Flask, Oracle
- Current focus: AI features in SaaS portfolio, MCP servers, workshops
- Conference goal: workshop fodder, LinkedIn content, contrarian framings
- Vendor tolerance: low
-->
### If this section is empty AND you have no system-level context about me
Run this interview as a **single batched message** before doing anything else:
1. **Role and seniority** — solo dev, team lead, IC, founder, manager, etc.
2. **Primary tech stack** — languages, frameworks, infra, deployment
3. **Wrong-fit stacks** — what should drag a rating down
4. **Current focus** — what I'm actively building or shipping
5. **Why I'm at this conference** — workshop fodder, learning, hiring, networking, tool evaluation, LinkedIn content, talent scouting, etc.
6. **Vendor-pitch tolerance** — open to product-led talks, or do they tank a rating?
7. **Anything else** — speakers I want to see, topics I'm sick of, format preferences (talks vs. workshops vs. networking)
Wait for my answers before producing the plan.
## Output format
Single table, one row per talk, grouped by time block, covering **all parallel tracks**:
| Time | Talk | 1–2 sentence summary | Room | Rating /10 | Pros | Cons |
### Rating scale (value to ME specifically — not absolute talk quality)
- **9–10** — must attend; bullseye for stack, role, or content goals
- **7–8** — strong fit, clear takeaway
- **5–6** — tangentially useful, not aligned
- **3–4** — wrong stack, vendor pitch, or audience mismatch
- **1–2** — skip
### After the table
1. **Top pick per time slot** — one line each with a one-line "why"
2. **The spine of the day** — one paragraph tying the picks into a narrative arc
## Tone
Direct. Opinionated. No hedging. Call out vendor pitches, weak slots, overlapping content, and basics I likely already know. If a slot is genuinely weak, say "skip" and recommend the time go to coffee, hallway track, or writing.
## Don't
- Don't pad ratings to be diplomatic
- Don't invent sessions if the schedule fetch failed — ask for the pasted text instead
- Don't repeat the rating scale or methodology in the outpu