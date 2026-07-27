Yes. It works best when the two systems answer **different questions**:

- **Alchemical rank:** How far have you progressed relative to the wider community?
- **Tarot Arcana:** What have you personally overcome, learned, or completed?

The metal ranks can be public and competitive. The Tarot cards should be permanent, personal, and narrative.

## The Personal Arcana

Do not make Tarot another eight-level ladder. Make each card represent a distinct kind of achievement.

A user gradually reveals cards through meaningful behavior:

| Card               | Personal achievement    | Example trigger                                                           |
| ------------------ | ----------------------- | ------------------------------------------------------------------------- |
| **The Fool**       | Beginning               | Complete the first recorded session                                       |
| **The Magician**   | Using every tool        | Log training, nutrition, and recovery within one week                     |
| **The Emperor**    | Structure               | Complete a full planned training block                                    |
| **The Chariot**    | Momentum                | Complete a high percentage of planned sessions for several weeks          |
| **Strength**       | Controlled progression  | Reach a personal strength milestone or improve against their own baseline |
| **The Hermit**     | Reflection              | Complete several weekly reviews and use them to guide training            |
| **Justice**        | Honest assessment       | Record a benchmark and adjust the plan based on the result                |
| **The Hanged Man** | Restraint               | Complete a planned deload or choose recovery instead of forcing a session |
| **Death**          | Transformation          | End a plan that no longer works and begin a better one                    |
| **Temperance**     | Balance                 | Maintain training, nutrition, and recovery together                       |
| **The Tower**      | Return after disruption | Resume consistent work after an extended interruption                     |
| **The Star**       | Rebuilding              | Establish momentum again after a difficult period                         |
| **The Sun**        | Achievement             | Reach a major user-defined goal                                           |
| **Judgement**      | Reckoning               | Complete a long-term comparison against the original baseline             |
| **The World**      | Completion              | Finish an entire training cycle from assessment through review            |

The cards should reflect **relative personal progress**, not just raw lifting totals. Otherwise, they become a second leaderboard and naturally favor stronger or more experienced users.

## Strongest combined system

The Tarot cards can themselves move through the stages of the Great Work.

### 1. Revealed — Nigredo

The card is first earned in a dark, incomplete state.

The user has encountered the lesson, but has not yet integrated it.

### 2. Refined — Albedo

The behavior has been repeated consistently.

The illustration becomes clearer and more complete.

### 3. Illuminated — Citrinitas

The user has produced measurable insight or improvement from that behavior.

A muted gold element enters the card.

### 4. Mastered — Rubedo

The behavior has become part of the user’s long-term practice.

The card receives its completed red seal.

You do not necessarily need to show all four historical terms prominently. The interface could simply say:

```text
REVEALED
REFINED
ILLUMINATED
MASTERED
```

The underlying concept still follows the Magnum Opus.

## Example: Strength

### Revealed

**VIII · STRENGTH**

You exceeded your previous record.

### Refined

You progressed the same movement across multiple sessions without sacrificing consistency.

### Illuminated

Your training record shows a sustained improvement over the original baseline.

### Mastered

Strength has become repeatable—not accidental.

That is far more meaningful than earning a shiny badge because the user crossed an arbitrary XP threshold.

## Example: Temperance

### Revealed

You completed your first planned recovery period.

### Refined

You maintained training without repeatedly exceeding your recovery capacity.

### Illuminated

Your strongest progress appeared alongside more balanced recovery.

### Mastered

You learned that restraint is part of the work.

This allows achievements for behaviors that traditional fitness apps usually ignore.

## How it should appear in the product

Create an **Arcana** area on the user profile.

The screen could contain:

```text
THE PERSONAL ARCANA

14 of 22 revealed
6 refined
2 illuminated
1 mastered
```

Below that, show a restrained Tarot grid:

- unrevealed cards as faint numbered silhouettes
- revealed cards in monochrome
- refined cards with cleaner silver linework
- illuminated cards with muted gold
- mastered cards with an oxblood seal

Opening a card shows:

- card name and number
- its meaning inside Transmute
- why the user earned it
- the exact date it was revealed
- progress toward its next state
- a short record of the actions that contributed

The user could pin up to three cards as their **current spread**.

For example:

```text
YOUR CURRENT SPREAD

PAST
The Tower
You returned after disruption.

PRESENT
The Chariot
You are building momentum.

BECOMING
Temperance
Balance training with recovery.
```

“Becoming” should be determined from an achievement the user is actively progressing toward. It should not pretend to predict their future.

## Leaderboard integration

On the leaderboard, keep the hierarchy clear:

```text
JON

VI · SILVER
LUNA

Current Arcana: Strength
```

The metal rank remains the competitive status. The Tarot card adds personality and explains what kind of journey the user is currently on.

Users could choose which mastered or active card appears beside their leaderboard profile. The card should **not add leaderboard points**.

## Do not launch with all 78 cards

Start with approximately **12–15 Major Arcana cards**. That is enough to create a meaningful system without inventing weak achievements merely to fill the deck.

A strong launch set would be:

```text
The Fool
The Magician
The Emperor
The Chariot
Strength
The Hermit
Justice
The Hanged Man
Death
Temperance
The Tower
The Star
The Sun
Judgement
The World
```

Later, the Minor Arcana could support smaller category achievements:

- **Wands:** training and effort
- **Cups:** recovery and wellbeing
- **Swords:** planning, technique, and analysis
- **Pentacles:** nutrition, consistency, and physical foundation

Major Arcana should remain rare and memorable. Minor Arcana could represent smaller repeatable milestones.

## The core product language

I would describe the systems internally like this:

> **Rank measures standing. Arcana records transformation.**

And in user-facing copy:

> Your rank reflects the weight of your record.
> Your Arcana reveals the work that changed you.

That gives Transmute competitive progression without reducing every form of personal achievement to numbers.

Yes. The cleanest implementation is:

> **Rank measures standing. Arcana records personal transformation.**

Each Major Arcana card is permanent and advances through four states:

1. **Revealed** — the user encounters the lesson once.
2. **Refined** — the behavior becomes repeatable.
3. **Illuminated** — the record shows that the behavior produced insight or progress.
4. **Mastered** — it becomes part of the user’s long-term practice.

A card never downgrades. Its progress can pause, but an earned state remains part of the user’s record.

# Shared definitions

Make the thresholds configurable rather than scattering magic numbers throughout the code.

### Qualified session

A session counts when it contains either:

- at least 3 working sets, or
- at least 10 minutes of recorded training, or
- a completed planned recovery, mobility, or endurance session.

Warm-up sets alone should not qualify.

### Consistent week

A week where the user completes:

- at least 80% of planned sessions, or
- their configured weekly target when they do not use a formal plan.

Require at least two sessions unless their plan intentionally contains only one.

### Balanced week

A week meeting all three:

- training: at least 80% adherence
- recovery: at least 4 check-ins
- nutrition: at least 4 completed daily logs or user-defined nutrition targets

These numbers should adapt when the user has configured different tracking frequencies.

### Training block

A structured plan lasting at least four weeks, containing:

- start and end date
- scheduled sessions
- primary goal
- baseline metric
- final review

### Personal baseline

Use the median of the first three comparable performances rather than one unusually good or bad session.

For weighted exercises, calculate estimated one-rep max only from working sets of 1–10 reps:

```text
e1RM = weight × (1 + reps / 30)
```

Also recognize:

- more reps at the same weight
- more weight for the same reps
- higher total volume
- better distance or time for endurance activities
- longer duration for holds
- harder exercise variation for bodyweight movements

The exercise definition should specify which performance metric is meaningful.

---

# The Personal Arcana

## 0 · The Fool

**Meaning:** Beginning the work.

### Revealed

Complete the first qualified session.

### Refined

Complete 3 qualified sessions within 14 days.

### Illuminated

Complete 10 sessions within 42 days and achieve at least 70% plan adherence.

### Mastered

Complete 50 lifetime sessions across at least 12 distinct active weeks.

**Required data:** session completion, date, working sets or duration.

---

## I · The Magician

**Meaning:** Learning to use the whole system.

### Revealed

Record training, nutrition, and recovery within the same seven-day period.

### Refined

Do this in 3 distinct weeks within a six-week period.

### Illuminated

Complete 4 consecutive balanced weeks.

### Mastered

Complete 12 balanced weeks within a rolling 16-week period.

**Required data:** training logs, nutrition logs, recovery check-ins.

The Magician rewards use of every tool. It does not require measurable improvement yet.

---

## IV · The Emperor

**Meaning:** Building structure and following it.

### Revealed

Create or accept a structured plan and complete its first scheduled session.

### Refined

Maintain at least 80% planned-session adherence for four weeks.

### Illuminated

Complete an entire block of at least six weeks with 85% adherence.

### Mastered

Complete two structured blocks with at least 85% adherence in each.

**Required data:** planned sessions, completion status, rescheduling, block dates.

Legitimate rescheduling should not reduce adherence. Silent skipping should.

---

## VII · The Chariot

**Meaning:** Creating momentum.

### Revealed

Complete the weekly session target for the first time.

### Refined

Meet the weekly target for 4 consecutive weeks.

### Illuminated

Maintain an 8-week streak with at least 80% adherence.

### Mastered

Maintain a 16-week streak without an unplanned training gap longer than 14 days.

**Required data:** weekly target or plan, completed sessions, planned recovery periods.

Planned deloads and scheduled vacations should not break the streak when recorded in advance.

---

## VIII · Strength

**Meaning:** Turning effort into greater capacity.

### Revealed

Set the first verified personal best after establishing a baseline.

### Refined

Record verified personal bests on 3 separate dates.

These may be:

- three improvements in one primary exercise, or
- improvements across three different exercises.

### Illuminated

Improve a primary performance metric by at least 5% over an eight-week period with at least eight relevant sessions.

### Mastered

Reach at least 10% improvement over baseline and reproduce the improved result on three dates at least 14 days apart.

**Required data:** exercise identity and variation, weight, repetitions, duration, distance, working-set status.

Strength should reward repeatable improvement, not one accidental peak.

---

## IX · The Hermit

**Meaning:** Reflecting on the record.

### Revealed

Complete the first weekly review.

### Refined

Complete 4 weekly reviews within six weeks.

### Illuminated

Use a review to make a documented adjustment, then complete at least 3 sessions under the adjusted plan.

### Mastered

Complete 12 reviews within 16 weeks and make at least 3 documented evidence-based adjustments.

**Required data:** review date, written reflection, selected adjustment, affected plan or exercise.

A useful review template could ask:

- What worked?
- What did not?
- What will change next week?

---

## XI · Justice

**Meaning:** Measuring honestly and responding to evidence.

### Revealed

Create a goal containing:

- baseline
- target
- measurement method
- reassessment date

### Refined

Complete the scheduled reassessment using the same measurement method.

### Illuminated

Make and document a plan decision based on the result:

- continue
- progress
- reduce
- replace
- extend the deadline
- revise the target

### Mastered

Complete 3 baseline → reassessment → decision cycles over at least 12 weeks.

**Required data:** goals, baselines, targets, assessments, decision reasons.

Justice should not require that every result be positive. An honest adjustment still qualifies.

---

## XII · The Hanged Man

**Meaning:** Understanding when restraint is productive.

### Revealed

Complete the first planned deload, reduced-intensity session, or recovery substitution.

### Refined

Make 3 appropriate recovery adjustments based on low readiness.

Example low-readiness conditions:

- sleep substantially below the user’s baseline
- unusually high soreness
- unusually low energy
- high reported stress
- pain or injury flag

### Illuminated

Complete a deload period and resume normal training within seven days of its planned end.

### Mastered

Complete 3 successful recovery cycles where post-deload performance returns to within 98% of the prior baseline or improves.

**Required data:** readiness check-in, planned session intensity, deload flag, substitution reason.

Do not automatically diagnose whether someone should train. The user or their plan chooses the adjustment; the system records it.

---

## XIII · Death

**Meaning:** Ending what no longer works and beginning again.

### Revealed

Archive or end a plan and record why it is ending.

### Refined

Begin a replacement plan within 14 days.

### Illuminated

Complete 4 weeks of the replacement plan with at least 80% adherence.

### Mastered

The replacement plan must produce either:

- measurable improvement in the target metric, or
- an adherence increase of at least 15 percentage points compared with the previous block.

**Required data:** archived plans, ending reason, replacement-plan relationship, adherence, target metrics.

Valid ending reasons could include:

- goal completed
- plateau
- schedule changed
- equipment changed
- recovery problem
- loss of interest
- plan was unrealistic

---

## XIV · Temperance

**Meaning:** Balancing training, nutrition, and recovery.

### Revealed

Complete one balanced week.

### Refined

Complete 4 balanced weeks within six weeks.

### Illuminated

Complete 8 balanced weeks within ten weeks, with no tracked category falling below 70% adherence.

### Mastered

Complete 16 balanced weeks within twenty weeks while maintaining or improving the primary performance metric.

**Required data:** training adherence, recovery check-ins, nutrition adherence, primary performance metric.

Temperance should not demand perfection. It rewards sustained balance without allowing one area to be ignored.

---

## XVI · The Tower

**Meaning:** Returning after disruption.

An interruption should be detected only when the user previously had at least four consistent weeks.

### Revealed

After an interruption of at least 14 days, complete the first return session.

### Refined

Complete 3 qualified sessions within 14 days of returning.

### Illuminated

Within six weeks, regain at least 80% of either:

- previous weekly training frequency, or
- previous performance baseline.

### Mastered

Complete 8 consistent weeks after the interruption and recover at least 95% of the previous performance baseline.

**Required data:** prior consistency, inactivity period, return date, frequency, performance baseline.

The Tower recognizes the return itself. It should never punish the user for having been interrupted.

---

## XVII · The Star

**Meaning:** Rebuilding after disruption.

The Star becomes available after The Tower has been revealed.

### Revealed

Complete 2 consistent weeks after returning.

### Refined

Complete 4 consistent weeks while also logging recovery.

### Illuminated

Return to the pre-interruption performance baseline or improve at least 5% from the immediate post-return baseline.

### Mastered

Complete a 12-week rebuilding period and finish above the pre-interruption baseline.

**Required data:** Tower event, post-return baseline, previous baseline, consistency, recovery records.

The distinction is:

- **The Tower:** “I returned.”
- **The Star:** “I rebuilt.”

---

## XIX · The Sun

**Meaning:** Reaching a meaningful personal goal.

A qualifying goal must be created before it is achieved and remain active for at least seven days.

### Revealed

Complete the first major user-defined goal.

### Refined

Complete a second major goal.

### Illuminated

Complete goals in two different domains, such as:

- strength
- endurance
- consistency
- mobility
- nutrition
- recovery
- body measurement
- skill or movement mastery

### Mastered

Complete 4 major goals across at least 2 domains, with one result confirmed by a follow-up assessment.

**Required data:** goal domain, target, baseline, creation date, completion evidence, confirmation assessment.

Do not count automatically generated micro-goals as Sun achievements.

---

## XX · Judgement

**Meaning:** Comparing who the user is now with where they began.

### Revealed

Complete the first formal reassessment after at least eight weeks of recorded work.

### Refined

Compare the reassessment with the original baseline across at least three metrics.

Possible metrics:

- primary exercise performance
- total training volume
- session adherence
- recovery trend
- endurance performance
- body measurement
- nutrition adherence

### Illuminated

Use the reassessment to choose and document the next direction.

### Mastered

Complete 3 full reassessment cycles over at least six months.

**Required data:** formal assessments, baseline snapshots, comparison metrics, next-cycle decision.

Justice evaluates an individual decision. Judgement evaluates a larger period of personal change.

---

## XXI · The World

**Meaning:** Completing the entire cycle of work.

### Revealed

Complete one full training cycle containing:

1. baseline
2. goal
3. structured plan
4. recorded work
5. final assessment
6. written review

### Refined

Complete 2 full cycles.

### Illuminated

Complete 3 cycles, including at least one that required a documented mid-cycle adjustment.

### Mastered

Complete 4 full cycles across at least twelve months, with measurable improvement in at least three.

**Required data:** linked goals, blocks, assessments, adjustments, reviews.

The World should be rare. It represents completion of the process, not simply a large number of workouts.

# Additional data worth recording

Your existing weight, reps, duration, and progress data covers a large part of this. I would add these fields.

## Session planning

```text
planned_at
completed_at
status
template_id
block_id
is_deload
is_recovery_session
rescheduled_from
skip_reason
```

## Working-set information

```text
exercise_id
exercise_variant_id
set_type
weight
reps
duration
distance
rpe
rir
is_working_set
```

`RPE` or `RIR` is especially useful for determining whether progression remained controlled.

## Daily recovery check-in

Keep it very quick:

```text
sleep_duration
sleep_quality      1–5
energy             1–5
soreness           1–5
stress              1–5
pain_or_injury_flag
optional_note
```

You can derive a readiness score, but keep the original values too.

## Nutrition adherence

Avoid forcing every user into calorie counting. Store flexible user-defined targets:

```text
nutrition_log_complete
protein_target_met
hydration_target_met
calorie_target_status
custom_targets_met
```

## Reviews and decisions

```text
review_period_start
review_period_end
what_worked
what_did_not
decision
decision_reason
affected_plan_id
```

## Goals and assessments

```text
goal_domain
metric_type
baseline_value
target_value
target_date
measurement_method
assessment_date
assessment_value
goal_status
```

# Important implementation rules

- Put thresholds in a versioned rules configuration.
- Store the event that caused every unlock.
- Recalculate progress after edited or deleted logs.
- Do not unlock streak achievements from obviously empty or duplicate sessions.
- Backfilled sessions can contribute to totals, but consider preventing very old backfills from creating live streak notifications.
- Planned deloads should not break consistency.
- A missed session moved before its scheduled time should count as rescheduled, not skipped.
- Major achievements should show the actual evidence that triggered them.
- Never remove an earned Arcana state because later performance declined.

A card detail should be able to say something concrete like:

```text
VIII · STRENGTH
ILLUMINATED

Your estimated Bench Press strength increased
from 185 lb to 196 lb across 11 sessions.

Illuminated July 24, 2026
```

That evidence is what makes the Arcana feel personal rather than like decorative badges.
