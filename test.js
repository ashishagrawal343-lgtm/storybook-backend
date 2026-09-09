const axios = require('axios');

async function testBookGeneration() {
    console.log(" Starting test... Please wait, this takes about 45 seconds.");
    try {
        const response = await axios.post('http://127.0.0.1:3000/api/create-book', {
            childName: "Aarav",
            theme: "Space Adventure",
            photoUrl: "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?w=500" // A cute kid photo from the internet
        });
        console.log("✅ Success! Your book is ready:");
        console.log(response.data.pdfUrl);
    } catch (error) {
        console.error("❌ Error:", error.response ? error.response.data : error.message);
    }
}

testBookGeneration();