// availability.js
// FIXED: correct localhost API call (NOT a file path)

async function checkAvailability() {
  try {
    const room = document.getElementById("room").value;
    const checkin = document.getElementById("checkin").value;
    const checkout = document.getElementById("checkout").value;

    if (!room || !checkin || !checkout) {
      alert("Please fill all fields");
      return;
    }

    const response = await fetch(
      `http://localhost:3000/api/bookings/availability?room=${encodeURIComponent(room)}&checkin=${checkin}&checkout=${checkout}`
    );

    if (!response.ok) {
      throw new Error("Request failed");
    }

    const data = await response.json();

    if (data.available) {
      alert("✅ Room is available");
    } else {
      alert("❌ Room is not available");
    }

  } catch (err) {
    console.error(err);
    alert("ERROR CHECKING AVAILABILITY");
  }
}