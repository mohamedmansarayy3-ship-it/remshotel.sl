// worker.js
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

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

    if (url.pathname === "/api/booking" && request.method === "POST") {
      try {
        // Check content-type to avoid parsing errors on empty/invalid bodies
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          return new Response(
            JSON.stringify({
              success: false,
              message: "Content-Type must be application/json"
            }),
            {
              status: 415,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders
              }
            }
          );
        }

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
      } catch (err) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Invalid JSON body"
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }
    }

    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};
