const InputController = require('../services/InputController');

console.log("🧪 Testing Input Bridge...");
console.log("👉 I will move the mouse in a square and type 'hello' in 3 seconds.");

setTimeout(async () => {
    try {
        console.log("⬇️ Moving Mouse...");
        InputController.moveMouse(500, 500);
        await new Promise(r => setTimeout(r, 500));

        InputController.moveMouse(600, 500);
        await new Promise(r => setTimeout(r, 500));

        InputController.moveMouse(600, 600);
        await new Promise(r => setTimeout(r, 500));

        InputController.moveMouse(500, 600);
        await new Promise(r => setTimeout(r, 500));

        console.log("🖱️ Clicking...");
        InputController.click();

        console.log("⌨️ Typing...");
        InputController.type("hello from test");

        console.log("✅ Test Complete. Did you see movement?");
        process.exit(0);
    } catch (e) {
        console.error("❌ Test Failed:", e);
    }
}, 3000);
