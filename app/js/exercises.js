// Exercise library. `cat`/`fit` map to Garmin FIT exercise_category / <cat>_exercise_name,
// so exported workouts show the right exercise (and animation) on the watch.
// muscle groups drive the weekly "sets per muscle" chart. kind: 'w' weight+reps, 'bw' bodyweight reps, 't' time.
export const EXERCISES = [
  // Chest
  { id: 'bench', name: 'Bench Press (Barbell)', cat: 'benchPress', fit: 'barbellBenchPress', muscles: ['chest', 'triceps', 'shoulders'], kind: 'w' },
  { id: 'db-bench', name: 'Bench Press (Dumbbell)', cat: 'benchPress', fit: 'dumbbellBenchPress', muscles: ['chest', 'triceps', 'shoulders'], kind: 'w' },
  { id: 'incline-bench', name: 'Incline Bench Press (Barbell)', cat: 'benchPress', fit: 'inclineBarbellBenchPress', muscles: ['chest', 'shoulders', 'triceps'], kind: 'w' },
  { id: 'incline-db', name: 'Incline Bench Press (Dumbbell)', cat: 'benchPress', fit: 'inclineDumbbellBenchPress', muscles: ['chest', 'shoulders', 'triceps'], kind: 'w' },
  { id: 'close-grip', name: 'Close-Grip Bench Press', cat: 'benchPress', fit: 'closeGripBarbellBenchPress', muscles: ['triceps', 'chest'], kind: 'w' },
  { id: 'db-fly', name: 'Fly (Dumbbell)', cat: 'flye', fit: 'dumbbellFlye', muscles: ['chest'], kind: 'w' },
  { id: 'cable-fly', name: 'Cable Crossover', cat: 'flye', fit: 'cableCrossover', muscles: ['chest'], kind: 'w' },
  { id: 'pushup', name: 'Push-Up', cat: 'pushUp', fit: 'pushUp', muscles: ['chest', 'triceps', 'shoulders'], kind: 'bw' },
  { id: 'dip', name: 'Dip', cat: 'tricepsExtension', fit: 'bodyWeightDip', muscles: ['chest', 'triceps'], kind: 'bw' },
  // Back
  { id: 'deadlift', name: 'Deadlift (Barbell)', cat: 'deadlift', fit: 'barbellDeadlift', muscles: ['back', 'glutes', 'hamstrings'], kind: 'w' },
  { id: 'rdl', name: 'Romanian Deadlift', cat: 'deadlift', fit: 'romanianDeadlift', muscles: ['hamstrings', 'glutes', 'back'], kind: 'w' },
  { id: 'trap-dl', name: 'Trap Bar Deadlift', cat: 'deadlift', fit: 'trapBarDeadlift', muscles: ['quads', 'glutes', 'back'], kind: 'w' },
  { id: 'pullup', name: 'Pull-Up', cat: 'pullUp', fit: 'pullUp', muscles: ['back', 'biceps'], kind: 'bw' },
  { id: 'chinup', name: 'Chin-Up', cat: 'pullUp', fit: 'chinUp', muscles: ['back', 'biceps'], kind: 'bw' },
  { id: 'lat-pd', name: 'Lat Pulldown', cat: 'pullUp', fit: 'latPulldown', muscles: ['back', 'biceps'], kind: 'w' },
  { id: 'bb-row', name: 'Bent-Over Row (Barbell)', cat: 'row', fit: 'barbellRow', muscles: ['back', 'biceps'], kind: 'w' },
  { id: 'db-row', name: 'One-Arm Row (Dumbbell)', cat: 'row', fit: 'oneArmBentOverRow', muscles: ['back', 'biceps'], kind: 'w' },
  { id: 'cable-row', name: 'Seated Cable Row', cat: 'row', fit: 'seatedCableRow', muscles: ['back', 'biceps'], kind: 'w' },
  { id: 'face-pull', name: 'Face Pull', cat: 'row', fit: 'facePull', muscles: ['shoulders', 'back'], kind: 'w' },
  { id: 'shrug', name: 'Shrug (Barbell)', cat: 'shrug', fit: 'barbellShrug', muscles: ['back'], kind: 'w' },
  { id: 'back-ext', name: 'Back Extension', cat: 'hyperextension', fit: 'backExtensionWithOppositeArmAndLegReach', muscles: ['back', 'glutes'], kind: 'bw' },
  // Legs
  { id: 'squat', name: 'Back Squat (Barbell)', cat: 'squat', fit: 'barbellBackSquat', muscles: ['quads', 'glutes'], kind: 'w' },
  { id: 'front-squat', name: 'Front Squat (Barbell)', cat: 'squat', fit: 'barbellFrontSquat', muscles: ['quads', 'glutes'], kind: 'w' },
  { id: 'goblet', name: 'Goblet Squat', cat: 'squat', fit: 'gobletSquat', muscles: ['quads', 'glutes'], kind: 'w' },
  { id: 'leg-press', name: 'Leg Press', cat: 'squat', fit: 'legPress', muscles: ['quads', 'glutes'], kind: 'w' },
  { id: 'split-squat', name: 'Bulgarian Split Squat', cat: 'lunge', fit: 'dumbbellBulgarianSplitSquat', muscles: ['quads', 'glutes'], kind: 'w' },
  { id: 'lunge', name: 'Walking Lunge (Dumbbell)', cat: 'lunge', fit: 'walkingDumbbellLunge', muscles: ['quads', 'glutes'], kind: 'w' },
  { id: 'leg-ext', name: 'Leg Extension', cat: 'bandedExercises', fit: 'legExtension', muscles: ['quads'], kind: 'w' },
  { id: 'leg-curl', name: 'Leg Curl', cat: 'legCurl', fit: 'legCurl', muscles: ['hamstrings'], kind: 'w' },
  { id: 'hip-thrust', name: 'Hip Thrust (Barbell)', cat: 'hipRaise', fit: 'barbellHipThrustOnFloor', muscles: ['glutes', 'hamstrings'], kind: 'w' },
  { id: 'calf', name: 'Standing Calf Raise', cat: 'calfRaise', fit: 'standingCalfRaise', muscles: ['calves'], kind: 'w' },
  { id: 'step-up', name: 'Step-Up (Dumbbell)', cat: 'squat', fit: 'dumbbellStepUp', muscles: ['quads', 'glutes'], kind: 'w' },
  // Shoulders
  { id: 'ohp', name: 'Overhead Press (Barbell)', cat: 'shoulderPress', fit: 'overheadBarbellPress', muscles: ['shoulders', 'triceps'], kind: 'w' },
  { id: 'db-ohp', name: 'Shoulder Press (Dumbbell)', cat: 'shoulderPress', fit: 'dumbbellShoulderPress', muscles: ['shoulders', 'triceps'], kind: 'w' },
  { id: 'arnold', name: 'Arnold Press', cat: 'shoulderPress', fit: 'arnoldPress', muscles: ['shoulders'], kind: 'w' },
  { id: 'lat-raise', name: 'Lateral Raise', cat: 'lateralRaise', fit: 'seatedLateralRaise', muscles: ['shoulders'], kind: 'w' },
  { id: 'rear-delt', name: 'Rear Delt Fly', cat: 'lateralRaise', fit: 'seatedRearLateralRaise', muscles: ['shoulders'], kind: 'w' },
  // Arms
  { id: 'bb-curl', name: 'Curl (Barbell)', cat: 'curl', fit: 'barbellBicepsCurl', muscles: ['biceps'], kind: 'w' },
  { id: 'db-curl', name: 'Curl (Dumbbell)', cat: 'curl', fit: 'standingAlternatingDumbbellCurls', muscles: ['biceps'], kind: 'w' },
  { id: 'hammer', name: 'Hammer Curl', cat: 'curl', fit: 'dumbbellHammerCurl', muscles: ['biceps'], kind: 'w' },
  { id: 'pushdown', name: 'Triceps Pushdown', cat: 'tricepsExtension', fit: 'tricepsPressdown', muscles: ['triceps'], kind: 'w' },
  { id: 'skull', name: 'Skull Crusher', cat: 'tricepsExtension', fit: 'lyingEzBarTricepsExtension', muscles: ['triceps'], kind: 'w' },
  { id: 'oh-ext', name: 'Overhead Triceps Extension', cat: 'tricepsExtension', fit: 'overheadDumbbellTricepsExtension', muscles: ['triceps'], kind: 'w' },
  // Core & carries
  { id: 'plank', name: 'Plank', cat: 'plank', fit: 'plank', muscles: ['core'], kind: 't' },
  { id: 'side-plank', name: 'Side Plank', cat: 'plank', fit: 'sidePlank', muscles: ['core'], kind: 't' },
  { id: 'hanging-lr', name: 'Hanging Leg Raise', cat: 'legRaise', fit: 'hangingLegRaise', muscles: ['core'], kind: 'bw' },
  { id: 'crunch', name: 'Crunch', cat: 'crunch', fit: 'crunch', muscles: ['core'], kind: 'bw' },
  { id: 'cable-crunch', name: 'Cable Crunch', cat: 'crunch', fit: 'cableCrunch', muscles: ['core'], kind: 'w' },
  { id: 'ab-wheel', name: 'Ab Wheel Rollout', cat: 'core', fit: 'kneelingAbWheel', muscles: ['core'], kind: 'bw' },
  { id: 'russian-twist', name: 'Russian Twist', cat: 'core', fit: 'russianTwist', muscles: ['core'], kind: 'bw' },
  { id: 'farmer', name: "Farmer's Carry", cat: 'carry', fit: 'farmersWalk', muscles: ['back', 'core'], kind: 't' },
  // Power / conditioning
  { id: 'kb-swing', name: 'Kettlebell Swing', cat: 'hipSwing', fit: 'singleArmKettlebellSwing', muscles: ['glutes', 'hamstrings'], kind: 'w' },
  { id: 'clean', name: 'Power Clean', cat: 'olympicLift', fit: 'barbellPowerClean', muscles: ['back', 'quads', 'glutes'], kind: 'w' },
  { id: 'box-jump', name: 'Box Jump', cat: 'plyo', fit: 'boxJump', muscles: ['quads', 'glutes'], kind: 'bw' },
  { id: 'burpee', name: 'Burpee', cat: 'totalBody', fit: 'burpee', muscles: ['core', 'chest', 'quads'], kind: 'bw' },
];

export const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];

const byId = new Map(EXERCISES.map((e) => [e.id, e]));
export function exercise(id, custom = []) {
  return byId.get(id) || custom.find((e) => e.id === id) || { id, name: id, cat: 'unknown', muscles: [], kind: 'w' };
}
