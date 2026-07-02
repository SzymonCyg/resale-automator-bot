const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { name, condition, size, price, packageSize } = await req.json();

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompt = `Jesteś ekspertem sprzedaży na Vinted. Na podstawie danych sprzedawcy przygotuj profesjonalne ogłoszenie.

Dane:
- Produkt: ${name || ''}
- Stan (opis sprzedawcy): ${condition || ''}
- Rozmiar: ${size || ''}
- Cena: ${price || ''}
- Wielkość paczki: ${packageSize || ''}

LISTA KATEGORII VINTED (użyj DOKŁADNIE jednej z tych ścieżek):
Mężczyźni > Obuwie > Sneakersy
Mężczyźni > Obuwie > Trekkingi
Mężczyźni > Obuwie > Buty do biegania
Mężczyźni > Obuwie > Obuwie sportowe > Halówki piłkarskie
Mężczyźni > Obuwie > Obuwie sportowe > Buty do fitnessu
Mężczyźni > Obuwie > Obuwie sportowe > Buty motocyklowe
Mężczyźni > Obuwie > Obuwie sportowe > Rolki i wrotki
Mężczyźni > Obuwie > Sandały i klapki
Mężczyźni > Obuwie > Mokasyny i lordsy
Mężczyźni > Obuwie > Kozaki i botki
Mężczyźni > Obuwie > Półbuty i oksfordy
Mężczyźni > Obuwie > Kalosze i śniegowce
Mężczyźni > Obuwie > Kapcie
Mężczyźni > Ubrania > Kurtki i płaszcze
Mężczyźni > Ubrania > Bluzy
Mężczyźni > Ubrania > T-shirty
Mężczyźni > Ubrania > Spodnie
Mężczyźni > Ubrania > Swetry i kardigany
Mężczyźni > Ubrania > Koszule
Mężczyźni > Ubrania > Dresy
Mężczyźni > Ubrania > Szorty
Mężczyźni > Ubrania > Bielizna i skarpety
Mężczyźni > Akcesoria > Czapki i kapelusze
Mężczyźni > Akcesoria > Torby i plecaki
Mężczyźni > Akcesoria > Paski
Mężczyźni > Akcesoria > Zegarki
Kobiety > Obuwie > Sneakersy
Kobiety > Obuwie > Trekkingi
Kobiety > Obuwie > Buty na obcasie
Kobiety > Obuwie > Kozaki i botki
Kobiety > Obuwie > Sandały i klapki
Kobiety > Obuwie > Baleriny i mokasyny
Kobiety > Obuwie > Buty sportowe
Kobiety > Obuwie > Kapcie
Kobiety > Obuwie > Kalosze i śniegowce
Kobiety > Ubrania > Sukienki
Kobiety > Ubrania > Bluzki i koszule
Kobiety > Ubrania > Kurtki i płaszcze
Kobiety > Ubrania > Spodnie
Kobiety > Ubrania > Spódnice
Kobiety > Ubrania > Swetry i kardigany
Kobiety > Ubrania > Bluzy
Kobiety > Ubrania > T-shirty
Kobiety > Ubrania > Bielizna i piżamy
Kobiety > Ubrania > Stroje kąpielowe
Kobiety > Ubrania > Dresy i komplety
Kobiety > Akcesoria > Torebki
Kobiety > Akcesoria > Szale i chusty
Kobiety > Akcesoria > Biżuteria
Kobiety > Akcesoria > Zegarki
Kobiety > Akcesoria > Czapki i kapelusze
Dzieci > Obuwie > Sneakersy
Dzieci > Obuwie > Sandały
Dzieci > Obuwie > Buty zimowe
Dzieci > Obuwie > Kapcie
Dzieci > Ubrania > Kurtki
Dzieci > Ubrania > Spodnie
Dzieci > Ubrania > Bluzy
Dzieci > Ubrania > T-shirty
Dzieci > Ubrania > Sukienki i spódniczki
Dzieci > Akcesoria > Czapki

Zwróć TYLKO JSON (bez markdown):
{"title":"chwytliwy tytuł max 60 znaków","description":"naturalny opis po polsku uwzględniający WSZYSTKIE wady wymienione przez sprzedawcę, 2-5 zdań","brand":"marka lub ''","category":"DOKŁADNA ścieżka z listy powyżej","color":"jeden kolor po polsku (Biały/Czarny/Czerwony/Niebieski/Zielony/Szary/Brązowy/Żółty/Różowy/Beżowy/Fioletowy/Pomarańczowy/Złoty/Srebrny/Wielokolorowy)","condition":"DOKŁADNIE jedna z: Nowy z metką | Nowy bez metki | Bardzo dobry | Dobry | Zadowalający"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: `Anthropic API ${response.status}: ${err}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '';

    let parsed: {
      title?: string; description?: string; brand?: string;
      category?: string; color?: string; condition?: string;
    } = {};
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('AI nie zwróciło poprawnego JSON');
    }

    return new Response(JSON.stringify({
      title: parsed.title || '',
      description: parsed.description || '',
      brand: parsed.brand || '',
      category: parsed.category || '',
      color: parsed.color || '',
      condition: parsed.condition || '',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
