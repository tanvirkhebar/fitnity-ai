

import { httpRouter } from "convex/server";
import { WebhookEvent } from "@clerk/nextjs/server";
import { Webhook } from "svix";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const http = httpRouter();

if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY environment variable");
}
if (!process.env.CLERK_WEBHOOK_SECRET) {
    throw new Error("Missing CLERK_WEBHOOK_SECRET environment variable");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);


function unwrapNode<T>(obj: unknown): T | null {
    if (obj !== null && typeof obj === "object" && "node" in (obj as any)) {
        const candidate = (obj as any).node;
        if (candidate !== null && typeof candidate === "object") {
            return candidate as T;
        }
    }
    return (obj as T) || null;
}


interface GenerateProgramPayload {
    user_id: string;
    age: number;
    height: string;
    weight: string;
    injuries: string;
    workout_days: string[];
    fitness_goal: string;
    fitness_level: string;
    dietary_restrictions: string[];
}

function assertPayloadShape(
    obj: unknown
): { payload?: GenerateProgramPayload; error?: string } {
    if (obj === null || typeof obj !== "object") {
        return { error: "Payload is not an object." };
    }
    const raw = obj as any;

    if (typeof raw.user_id !== "string") {
        return { error: "Missing or invalid 'user_id' (expected string)." };
    }
    if (typeof raw.age !== "number") {
        return { error: "Missing or invalid 'age' (expected number)." };
    }
    if (typeof raw.height !== "string") {
        return { error: "Missing or invalid 'height' (expected string)." };
    }
    if (typeof raw.weight !== "string") {
        return { error: "Missing or invalid 'weight' (expected string)." };
    }
    if (typeof raw.injuries !== "string") {
        return { error: "Missing or invalid 'injuries' (expected string)." };
    }
    if (
        !Array.isArray(raw.workout_days) ||
        raw.workout_days.some((d: unknown) => typeof d !== "string")
    ) {
        return { error: "Missing or invalid 'workout_days' (expected string[])." };
    }
    if (typeof raw.fitness_goal !== "string") {
        return { error: "Missing or invalid 'fitness_goal' (expected string)." };
    }
    if (typeof raw.fitness_level !== "string") {
        return { error: "Missing or invalid 'fitness_level' (expected string)." };
    }
    if (
        !Array.isArray(raw.dietary_restrictions) ||
        raw.dietary_restrictions.some((d: unknown) => typeof d !== "string")
    ) {
        return { error: "Missing or invalid 'dietary_restrictions' (expected string[])." };
    }

    return {
        payload: {
            user_id: raw.user_id,
            age: raw.age,
            height: raw.height,
            weight: raw.weight,
            injuries: raw.injuries,
            workout_days: raw.workout_days,
            fitness_goal: raw.fitness_goal,
            fitness_level: raw.fitness_level,
            dietary_restrictions: raw.dietary_restrictions,
        },
    };
}


type WorkoutPlanShape = {
    schedule: string[];
    exercises: {
        day: string;
        routines: {
            name: string;
            sets: number;
            reps: number;
        }[];
    }[];
};

function assertWorkoutShape(
    obj: unknown
): { value?: WorkoutPlanShape; error?: string } {
    if (obj === null || typeof obj !== "object") {
        return { error: "Workout plan is not an object." };
    }
    const raw = obj as any;
    if (!Array.isArray(raw.schedule) || raw.schedule.some((d: unknown) => typeof d !== "string")) {
        return { error: "Workout plan ‘schedule’ must be string[]." };
    }
    if (!Array.isArray(raw.exercises)) {
        return { error: "Workout plan ‘exercises’ must be an array." };
    }

    for (let i = 0; i < raw.exercises.length; i++) {
        const ex = raw.exercises[i];
        if (ex === null || typeof ex !== "object") {
            return { error: `Workout plan ‘exercises[${i}]’ is not an object.` };
        }
        if (typeof ex.day !== "string") {
            return { error: `Workout plan ‘exercises[${i}].day’ must be string.` };
        }
        if (!Array.isArray(ex.routines)) {
            return { error: `Workout plan ‘exercises[${i}].routines’ must be an array.` };
        }
        for (let j = 0; j < ex.routines.length; j++) {
            const r = ex.routines[j];
            if (r === null || typeof r !== "object") {
                return { error: `Workout plan ‘exercises[${i}].routines[${j}]’ is not an object.` };
            }
            if (typeof r.name !== "string") {
                return { error: `Workout plan ‘exercises[${i}].routines[${j}].name’ must be string.` };
            }
            if (typeof r.sets !== "number" || Number.isNaN(r.sets)) {
                return { error: `Workout plan ‘exercises[${i}].routines[${j}].sets’ must be number.` };
            }
            if (typeof r.reps !== "number" || Number.isNaN(r.reps)) {
                return { error: `Workout plan ‘exercises[${i}].routines[${j}].reps’ must be number.` };
            }
        }
    }

    return { value: raw as WorkoutPlanShape };
}

type DietPlanShape = {
    dailyCalories: number;
    meals: { name: string; foods: string[] }[];
};

function assertDietShape(
    obj: unknown
): { value?: DietPlanShape; error?: string } {
    if (obj === null || typeof obj !== "object") {
        return { error: "Diet plan is not an object." };
    }
    const raw = obj as any;
    if (typeof raw.dailyCalories !== "number" || Number.isNaN(raw.dailyCalories)) {
        return { error: "Diet plan ‘dailyCalories’ must be a number." };
    }
    if (!Array.isArray(raw.meals)) {
        return { error: "Diet plan ‘meals’ must be an array." };
    }
    for (let i = 0; i < raw.meals.length; i++) {
        const meal = raw.meals[i];
        if (meal === null || typeof meal !== "object") {
            return { error: `Diet plan ‘meals[${i}]’ is not an object.` };
        }
        if (typeof meal.name !== "string") {
            return { error: `Diet plan ‘meals[${i}].name’ must be string.` };
        }
        if (!Array.isArray(meal.foods) || meal.foods.some((f: unknown) => typeof f !== "string")) {
            return { error: `Diet plan ‘meals[${i}].foods’ must be string[].` };
        }
    }

    return { value: raw as DietPlanShape };
}

function validateWorkoutPlan(plan: any) {
    const validatedPlan = {
        schedule: plan.schedule,
        exercises: plan.exercises.map((exercise: any) => ({
            day: exercise.day,
            routines: exercise.routines.map((routine: any) => ({
                name: routine.name,
                sets:
                    typeof routine.sets === "number"
                        ? routine.sets
                        : parseInt(routine.sets) || 1,
                reps:
                    typeof routine.reps === "number"
                        ? routine.reps
                        : parseInt(routine.reps) || 10,
            })),
        })),
    };
    return validatedPlan;
}

function validateDietPlan(plan: any) {
    const validatedPlan = {
        dailyCalories: plan.dailyCalories,
        meals: plan.meals.map((meal: any) => ({
            name: meal.name,
            foods: meal.foods,
        })),
    };
    return validatedPlan;
}

http.route({
    path: "/clerk-webhook",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const svix_id = request.headers.get("svix-id");
        const svix_signature = request.headers.get("svix-signature");
        const svix_timestamp = request.headers.get("svix-timestamp");
        if (!svix_id || !svix_signature || !svix_timestamp) {
            return new Response("No svix headers found", { status: 400 });
        }

        let evt: WebhookEvent;
        try {
            const body = JSON.stringify(await request.json());
            evt = new Webhook(process.env.CLERK_WEBHOOK_SECRET!).verify(body, {
                "svix-id": svix_id,
                "svix-timestamp": svix_timestamp,
                "svix-signature": svix_signature,
            }) as WebhookEvent;
        } catch (err) {
            console.error("Error verifying webhook:", err);
            return new Response("Invalid webhook signature", { status: 400 });
        }

        const eventType = evt.type;
        if (eventType === "user.created") {
            const { id, first_name, last_name, image_url, email_addresses } = evt.data;
            const email = email_addresses[0].email_address;
            const name = `${first_name || ""} ${last_name || ""}`.trim();
            try {
                await ctx.runMutation(api.users.syncUser, {
                    email,
                    name,
                    image: image_url,
                    clerkId: id,
                });
            } catch (error) {
                console.error("Error creating user in DB:", error);
                return new Response("Error creating user", { status: 500 });
            }
        } else if (eventType === "user.updated") {
            const { id, email_addresses, first_name, last_name, image_url } = evt.data;
            const email = email_addresses[0].email_address;
            const name = `${first_name || ""} ${last_name || ""}`.trim();
            try {
                await ctx.runMutation(api.users.updateUser, {
                    clerkId: id,
                    email,
                    name,
                    image: image_url,
                });
            } catch (error) {
                console.error("Error updating user in DB:", error);
                return new Response("Error updating user", { status: 500 });
            }
        }

        return new Response("Webhooks processed successfully", { status: 200 });
    }),
});


http.route({
    path: "/vapi/generate-program",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        try {
            // 1) Read & unwrap any { node: { … } } wrapper
            const rawBody = await request.json();
            const unwrapped = unwrapNode<unknown>(rawBody) || null;

            const { payload, error: payloadError } = assertPayloadShape(unwrapped);
            if (payloadError) {
                return new Response(
                    JSON.stringify({ success: false, error: payloadError }),
                    { status: 400, headers: { "Content-Type": "application/json" } }
                );
            }
            const {
                user_id,
                age,
                height,
                weight,
                injuries,
                workout_days,
                fitness_goal,
                fitness_level,
                dietary_restrictions,
            } = payload!;

            console.log("Validated payload:", payload);


            const workoutPrompt = `You are an experienced fitness coach creating a personalized workout plan based on:
    Age: ${age}
    Height: ${height}
    Weight: ${weight}
    Injuries or limitations: ${injuries}
    Available days for workout: ${workout_days}
    Fitness goal: ${fitness_goal}
    Fitness level: ${fitness_level}

    As a professional coach:
    - Consider muscle group splits to avoid overtraining the same muscles on consecutive days
    - Design exercises that match the fitness level and account for any injuries
    - Structure the workouts to specifically target the user's fitness goal

    CRITICAL SCHEMA INSTRUCTIONS:
    - Your output MUST contain ONLY the fields specified below, NO ADDITIONAL FIELDS
    - "sets" and "reps" MUST ALWAYS be NUMBERS, never strings
    - For example: "sets": 3, "reps": 10
    - Do NOT use text like "reps": "As many as possible" or "reps": "To failure"
    - Instead use specific numbers like "reps": 12 or "reps": 15
    - For cardio, use "sets": 1, "reps": 1 or another appropriate number
    - NEVER include strings for numerical fields
    - NEVER add extra fields not shown in the example below

    Return a JSON object with this EXACT structure:
    {
    "schedule": ["Monday", "Wednesday", "Friday"],
    "exercises": [
        {
        "day": "Monday",
        "routines": [
            {
            "name": "Exercise Name",
            "sets": 3,
            "reps": 10
            }
        ]
        }
    ]
    }

    DO NOT add any fields that are not in this example. Your response must be a valid JSON object with no additional text.`;

            let workoutPlanRaw: unknown;
            try {
                const model = genAI.getGenerativeModel({
                    model: "gemini-2.0-flash-001",
                    generationConfig: {
                        temperature: 0.4,
                        topP: 0.9,
                        responseMimeType: "application/json",
                    },
                });
                const workoutResult = await model.generateContent(workoutPrompt);
                const workoutPlanText = workoutResult.response.text();
                workoutPlanRaw = JSON.parse(workoutPlanText);
            } catch (err) {
                console.error("Error generating or parsing workout plan from AI:", err);
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "Failed to generate a valid workout plan from AI.",
                    }),
                    { status: 500, headers: { "Content-Type": "application/json" } }
                );
            }


            const { value: workoutPlanChecked, error: workoutError } = assertWorkoutShape(workoutPlanRaw);
            if (workoutError) {
                console.error("Workout plan shape error:", workoutError, workoutPlanRaw);
                return new Response(
                    JSON.stringify({ success: false, error: `Invalid workout plan: ${workoutError}` }),
                    { status: 500, headers: { "Content-Type": "application/json" } }
                );
            }
            const workoutPlan = validateWorkoutPlan(workoutPlanChecked);


            const dietPrompt = `You are an experienced nutrition coach creating a personalized diet plan based on:
    Age: ${age}
    Height: ${height}
    Weight: ${weight}
    Fitness goal: ${fitness_goal}
    Dietary restrictions: ${dietary_restrictions}

    As a professional nutrition coach:
    - Calculate appropriate daily calorie intake based on the person's stats and goals
    - Create a balanced meal plan with proper macronutrient distribution
    - Include a variety of nutrient-dense foods while respecting dietary restrictions
    - Consider meal timing around workouts for optimal performance and recovery

    CRITICAL SCHEMA INSTRUCTIONS:
    - Your output MUST contain ONLY the fields specified below, NO ADDITIONAL FIELDS
    - "dailyCalories" MUST be a NUMBER, not a string
    - DO NOT add fields like "supplements", "macros", "notes", or ANYTHING else
    - ONLY include the EXACT fields shown in the example below
    - Each meal should include ONLY a "name" and "foods" array

    Return a JSON object with this EXACT structure and no other fields:
    {
    "dailyCalories": 2000,
    "meals": [
        {
        "name": "Breakfast",
        "foods": ["Oatmeal with berries", "Greek yogurt", "Black coffee"]
        },
        {
        "name": "Lunch",
        "foods": ["Grilled chicken salad", "Whole grain bread", "Water"]
        }
    ]
    }

    DO NOT add any fields that are not in this example. Your response must be a valid JSON object with no additional text.`;

            let dietPlanRaw: unknown;
            try {
                const model = genAI.getGenerativeModel({
                    model: "gemini-2.0-flash-001",
                    generationConfig: {
                        temperature: 0.4,
                        topP: 0.9,
                        responseMimeType: "application/json",
                    },
                });
                const dietResult = await model.generateContent(dietPrompt);
                const dietPlanText = dietResult.response.text();
                dietPlanRaw = JSON.parse(dietPlanText);
            } catch (err) {
                console.error("Error generating or parsing diet plan from AI:", err);
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "Failed to generate a valid diet plan from AI.",
                    }),
                    { status: 500, headers: { "Content-Type": "application/json" } }
                );
            }

            const { value: dietPlanChecked, error: dietError } = assertDietShape(dietPlanRaw);
            if (dietError) {
                console.error("Diet plan shape error:", dietError, dietPlanRaw);
                return new Response(
                    JSON.stringify({ success: false, error: `Invalid diet plan: ${dietError}` }),
                    { status: 500, headers: { "Content-Type": "application/json" } }
                );
            }
            const dietPlan = validateDietPlan(dietPlanChecked);


            let planId: string;
            try {
                planId = await ctx.runMutation(api.plans.createPlan, {
                    userId: user_id,
                    dietPlan,
                    isActive: true,
                    workoutPlan,
                    name: `${fitness_goal} Plan - ${new Date().toLocaleDateString()}`,
                });
            } catch (err) {
                console.error("Error saving plan to Convex:", err);
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: "Failed to save plan to database.",
                    }),
                    { status: 500, headers: { "Content-Type": "application/json" } }
                );
            }


            return new Response(
                JSON.stringify({
                    success: true,
                    data: {
                        planId,
                        workoutPlan,
                        dietPlan,
                    },
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            );
        } catch (unexpected) {
            console.error("Unexpected error in generate-program handler:", unexpected);
            return new Response(
                JSON.stringify({
                    success: false,
                    error: unexpected instanceof Error ? unexpected.message : String(unexpected),
                }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }
    }),
});

export default http;
