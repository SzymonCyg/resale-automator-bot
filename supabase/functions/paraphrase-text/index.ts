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
    const { title, description, language } = await req.json();

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const lang = language || 'pl';
    const langName =
      lang === 'pl' ? 'polskim'
      : lang === 'de' ? 'niemieckim'
      : lang === 'fr' ? 'francuskim'
      : lang === 'en' ? 'angielskim'
      : lang === 'cs' ? 'czeskim'
      : lang === 'it' ? 'włoskim'
      : lang === 'es' ? 'hiszpańskim'
      : 'oryginalnym';

    const prompt = `Jesteś asystentem sprzedawcy na platformie Vinted. Przepisz poniższy tytuł i opis ogłoszenia tak, aby:
- zachować to samo znaczenie, informacje, stan i parametry produktu
- użyć lekko zmienionych słów, synonimów lub innej kolejności informacji
- tekst był naturalny i po ${langName}
- NIE dodawać nowych informacji ani nie usuwać istniejących
- NIE zmieniać ceny, marki, rozmiaru, koloru ani stanu
- tytuł MAX 60 znaków

TYTUŁ ORYGINALNY: ${title}
OPIS ORYGINALNY: ${description || '(brak opisu)'}

Odpowiedz TYLKO w formacie JSON (bez markdown, bez \`\`\`):
{"title":"nowy tytuł","description":"nowy opis"}`;

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

    let parsed: { title?: string; description?: string } = {};
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('AI nie zwróciło poprawnego JSON');
    }

    return new Response(JSON.stringify({
      title: parsed.title || title,
      description: parsed.description || description,
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
