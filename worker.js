const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/api/status") {
      return new Response(
        JSON.stringify({
          success: true,
          service: "REMS HOTEL API",
          time: new Date().toISOString()
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }

    // Example booking endpoint
    if (url.pathname === "/api/booking" && request.method === "POST") {
      const data = await request.json();

      return new Response(
        JSON.stringify({
          success: true,
          message: "Booking received",
          data
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }

    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};
