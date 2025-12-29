require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function checkModels() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.log("No API Key found in .env");
        return;
    }

    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

        console.log("Attempting to generate with gemini-2.0-flash-exp...");
        const result = await model.generateContent("Hi");
        console.log("Success!");
    } catch (error) {
        console.log("\n❌ FULL ERROR DETAILS:");
        console.log(error);
        if (error.response) {
            console.log("\nResponse data:");
            console.log(JSON.stringify(error.response, null, 2));
        }
    }
}

checkModels();
