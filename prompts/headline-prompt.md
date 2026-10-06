# Prompt: turn demo narration into on-screen headlines

Paste the prompt below into your LLM of choice (Claude, etc.), fill in the three `{{...}}` blocks, and review
what comes back. These are the rules the existing headlines in `timings/suse-ai-factory-demo.json` were written with.

You write the **words** here. You add the **times** afterwards in the timing editor (the model can't see your video).

---

## The prompt

```text
You are writing on-screen headlines for a product demo video. The video has a narrator, and a headline bar at
the top of the screen that shows ONE short headline at a time, wiping in from left to right. Headlines tell the
viewer what they are looking at right now.

CONTEXT
- Product / event: {{PRODUCT AND AUDIENCE, e.g. "SUSE AI Factory demo for a booth at World Summit AI"}}
- The video's chapters (left-hand buttons): {{CHAPTER NAMES, in order}}
- The narration below belongs to this chapter: {{CHAPTER NAME}}
- Narration is a raw transcript. It may contain transcription mistakes and "(...)" markers where the
  narrator is silent while something happens on screen.

NARRATION
"""
{{PASTE THE NARRATION TRANSCRIPT HERE}}
"""

RULES
1. One headline per BEAT, not per sentence. A beat is a change of screen, step or topic. Use the "(...)"
   markers and topic shifts to find them. Usually 4 to 9 headlines per 2 to 3 minutes.
2. Short: 3 to 7 words and at most about 42 characters, so it fits on one line. The longest headline sets
   the text size for ALL of them, so one long headline makes every headline smaller.
3. Sentence case, no trailing full stop. Use the words the viewer sees on screen (button and menu names).
4. Start with a verb or a benefit where you can ("Select destination clusters", "See how your AI apps
   connect"). Speak to the viewer, not about the narrator.
5. Mark the one or two words that matter most with *asterisks*, for example "Select a name and *namespace*".
   An accent may span several words ("*AI stack*"). Never accent a whole headline.
6. Stay faithful to the narration. Do not add claims, numbers or benefits the narrator did not say.
   Avoid absolutes such as "CVE-free", "zero", "always", "never", "best". Prefer wording SUSE uses publicly,
   for example "pre-validated", "low CVE count".
7. Use current SUSE product names exactly: SUSE AI Factory, SUSE Rancher Prime, SUSE Application Collection,
   SUSE Observability, SUSE Virtualization, SUSE Security, SUSE Linux, SUSE Multi-Linux Manager (SUSE MLM). Fix obvious transcription errors (for example "VLM" is vLLM,
   "light LLM" is LiteLLM) and tell me you did.
8. Do not criticise or single out third-party projects by name. Describe the general problem instead.
9. Neighbouring headlines should not repeat each other's wording.
10. Each headline will stay on screen until the next one starts: aim for 5 to 25 seconds. If one beat is
    long, add a second headline part-way. If two beats are very short, merge them.
11. Skip any closing or sign-off line unless I ask for one.

OUTPUT
First, a Markdown table with the columns: #, Narration beat (a few words), Headline.
Then a short "Check these" list covering: transcription slips you corrected or are unsure about, product names
or claims I should verify, and any place where two headlines are very close in time.
Do not invent times.
```

---

## Example

Input (shortened):

```text
Chapter: Install Blueprints
Narration: "... I'm gonna pick the HR assistant blueprint. (...) Now I give it a name and a namespace. (...)
Next I choose which cluster to deploy to. (...) And I review everything and hit install."
```

Output:

| # | Narration beat | Headline |
|---|---|---|
| 1 | pick the blueprint | *Install* a blueprint in a few clicks |
| 2 | name and namespace | Select a name and *namespace* |
| 3 | choose the cluster | Select your target *cluster* |
| 4 | review and install | *Review* and install |

## After you have the words

1. Open the timing editor and **Open file…** on your `timings/<video>.json`.
2. Add one row per headline (**+ Add headline**), paste the text, and type the time from your Resolve timeline
   (`1:03:44` timecode or `3:44`).
3. Use the preview to check the headline fits and reads well. A **short** or **long** chip warns about headlines
   under 3 s or over 25 s.
