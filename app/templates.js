/**
 * SurveyAll — the Activity Library (pedagogy roadmap, feature 9).
 *
 * A deliberately tiny, curated set of classroom activities as insertable
 * question snippets. Each template names the practice it implements and
 * cites where the evidence comes from — the content encodes the research,
 * and an eleventh entry must evict one. Everything inserted becomes plain
 * editable questions; nothing here is locked.
 */

export const TEMPLATES = [
  {
    id: 'minute-paper',
    name: 'Minute Paper',
    blurb: 'The classic two-question closer, in its canonical wording.',
    source: 'Angelo & Cross, Classroom Assessment Techniques (1993)',
    questions: [
      {
        type: 'open_ended',
        prompt: 'What was the most important thing you learned during this class?',
        config: { max_length: 200 },
      },
      {
        type: 'open_ended',
        prompt: 'What important question remains unanswered for you?',
        config: { max_length: 200 },
      },
    ],
  },
  {
    id: 'muddiest-point',
    name: 'Muddiest Point',
    blurb: 'One question, honest answers — anonymity is what makes it work.',
    source: 'Angelo & Cross, Classroom Assessment Techniques (1993)',
    questions: [
      {
        type: 'open_ended',
        prompt: 'What was the muddiest point in today\'s class?',
        config: { max_length: 200 },
      },
    ],
  },
  {
    id: 'exit-ticket',
    name: 'Exit Ticket',
    blurb: 'Concept check + muddiest point + a confidence pulse. Open next class with the results.',
    source: 'Black & Wiliam, Inside the Black Box (1998) — the value is acting on it',
    questions: [
      {
        type: 'multiple_choice',
        prompt: 'Concept check — edit me: one question about today\'s key idea',
        config: { options: ['Option A', 'Option B', 'Option C'], mode: 'best', confidence: true },
      },
      {
        type: 'open_ended',
        prompt: 'What was the muddiest point in today\'s class?',
        config: { max_length: 200 },
      },
      {
        type: 'scales',
        prompt: 'How solid does today feel?',
        config: { statements: ['I could explain today\'s main idea to a classmate'], min: 1, max: 5 },
      },
    ],
  },
  {
    id: 'pi-concept-check',
    name: 'Peer Instruction check',
    blurb: 'A best-answer question built for the Discuss button: vote, argue, re-vote.',
    source: 'Mazur; Smith et al., Science (2009)',
    questions: [
      {
        type: 'multiple_choice',
        prompt: 'Edit me: a question with several defensible answers, one most defensible',
        config: {
          options: ['Defensible A', 'Most defensible B', 'Defensible C', 'Tempting misreading D'],
          correct: [1],
          mode: 'best',
          confidence: true,
        },
      },
    ],
  },
  {
    id: 'sift-source-check',
    name: 'SIFT source check',
    blurb: 'Judge a source, leave the page for 90 seconds, judge again. The swing is the lesson.',
    source: 'Wineburg & McGrew (2019); the SIFT method (Caulfield)',
    questions: [
      {
        type: 'multiple_choice',
        prompt: 'Edit me: paste/describe a source. Would you trust it for your essay?',
        config: {
          options: ['Trustworthy', 'Not trustworthy', 'Can\'t tell yet'],
          mode: 'opinion',
          confidence: true,
        },
      },
      {
        type: 'open_ended',
        prompt: 'You have 90 seconds: leave the page and search. What did you find out about this source?',
        config: { max_length: 240 },
      },
    ],
  },
  {
    id: 'they-say-i-say',
    name: 'They Say / I Say',
    blurb: 'The response stem as an input constraint — templates of the moves, not a handout.',
    source: 'Graff & Birkenstein, They Say / I Say',
    questions: [
      {
        type: 'open_ended',
        prompt: 'Complete the move: "While ___ argues ___, I contend ___ because ___."',
        config: { max_length: 300 },
      },
    ],
  },
  {
    id: 'four-corners',
    name: 'Four Corners opener',
    blurb: 'Stake a position before drafting a persuasive essay, then watch it move after debate.',
    source: 'Facing History four-corners protocol; Peer Instruction re-vote',
    questions: [
      {
        type: 'spectrum',
        prompt: 'Edit me: a claim worth arguing about',
        config: {
          left_label: 'Strongly disagree',
          right_label: 'Strongly agree',
          corners: true,
        },
      },
    ],
  },
  {
    id: 'toulmin-dissection',
    name: 'Toulmin dissection',
    blurb: 'The room tags claim, evidence and warrant — the disagreement over the warrant IS the lesson.',
    source: 'Toulmin, The Uses of Argument; standard FYC practice, finally live',
    questions: [
      {
        type: 'heatmap',
        prompt: 'Label the parts of this argument',
        config: {
          passage: 'Edit this argument. | This sentence is doing the work of evidence. | So the conclusion follows, given what we assume.',
          segments: [
            'Edit this argument.',
            'This sentence is doing the work of evidence.',
            'So the conclusion follows, given what we assume.',
          ],
          mode: 'classify',
          labels: ['claim', 'evidence', 'warrant'],
          max_picks: 1,
        },
      },
    ],
  },
  {
    id: 'thesis-showdown',
    name: 'Thesis showdown',
    blurb: 'Three anonymous thesis statements, one vote, one line of why. Run it before workshop day.',
    source: 'Lundstrom & Baker (2009): giving feedback trains the giver',
    questions: [
      {
        type: 'sample_vote',
        prompt: 'Which thesis would you rather read a paper about?',
        config: {
          samples: [
            'Edit me: paste thesis A (with its writer\'s permission).',
            'Edit me: paste thesis B.',
            'Edit me: paste thesis C.',
          ],
          allow_rationale: true,
        },
      },
    ],
  },
  {
    id: 'reading-temperature',
    name: 'Reading temperature',
    blurb: 'A one-word warm-up plus two honest scales — the discussion opener that shows the room to itself.',
    source: 'standard practice (Pitt, Hunter teaching centers); anonymity research on honest self-report',
    questions: [
      {
        type: 'word_cloud',
        prompt: 'One word for how the reading left you',
        config: { max_words: 1 },
      },
      {
        type: 'scales',
        prompt: 'Where are we with the reading?',
        config: {
          statements: ['I finished it', 'I could summarise its main move'],
          min: 1,
          max: 5,
          allow_skip: true,
        },
      },
    ],
  },
];
