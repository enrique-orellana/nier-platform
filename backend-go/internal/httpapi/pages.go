package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) galleryVideos(ctx context.Context, limit int) ([]map[string]any, error) {
	if s.translationRunner == nil {
		return nil, errors.New("Python worker is not configured")
	}
	result, err := s.translationRunner.Run(ctx, "gallery", "legacy_api", map[string]any{"action": "saas_gallery", "limit": limit, "output_dir": s.config.OutputDir}, nil)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Videos []map[string]any `json:"videos"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		return nil, err
	}
	return payload.Videos, nil
}

func (s *Server) galleryPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	videos, err := s.galleryVideos(r.Context(), 100)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	items := make([]map[string]any, 0, len(videos))
	var body strings.Builder
	body.WriteString(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI UGC Video Gallery | OpenShorts</title><meta name="description" content="Browse AI-generated UGC marketing videos for SaaS products."><meta name="robots" content="index, follow"><meta property="og:title" content="AI UGC Video Gallery | OpenShorts"><meta property="og:type" content="website"><meta property="og:description" content="Browse AI-generated UGC marketing videos for SaaS products.">`)
	for _, video := range videos {
		id := firstString(video, "video_id")
		if id == "" {
			continue
		}
		title := firstString(video, "title")
		product := firstString(video, "product_name")
		caption := firstString(video, "caption")
		mode := firstString(video, "video_mode")
		modeLabel := "PREMIUM"
		if mode == "lowcost" {
			modeLabel = "LOW COST"
		}
		items = append(items, map[string]any{"@type": "ListItem", "position": len(items) + 1, "url": "/video/" + id, "name": title})
		body.WriteString(`<article class="card"><a href="/video/` + html.EscapeString(url.PathEscape(id)) + `"><div class="preview"><video src="` + html.EscapeString(firstString(video, "video_url")) + `" poster="` + html.EscapeString(firstString(video, "actor_url")) + `" muted playsinline preload="metadata"></video><span class="mode">` + modeLabel + `</span></div><h2>` + html.EscapeString(title) + `</h2><p>` + html.EscapeString(fmt.Sprintf("%.0fs · %s", metadataFloat(video["duration"]), product)) + `</p><small>` + html.EscapeString(caption) + `</small></a></article>`)
	}
	ldJSON := map[string]any{"@context": "https://schema.org", "@type": "CollectionPage", "name": "AI UGC Video Gallery", "mainEntity": map[string]any{"@type": "ItemList", "numberOfItems": len(items), "itemListElement": items}}
	body.WriteString(`<style>*{box-sizing:border-box}body{background:#0a0a0c;color:#e4e4e7;font-family:system-ui,sans-serif;margin:0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;padding:20px;max-width:1400px;margin:auto}.card{background:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden}.card a{color:inherit;text-decoration:none}.preview{position:relative;aspect-ratio:9/16;background:#000}.preview video{width:100%;height:100%;object-fit:cover}.mode{position:absolute;top:8px;right:8px;background:#8b5cf6;color:white;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700}.card h2{font-size:14px;margin:12px 12px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.card p,.card small{display:block;color:#71717a;margin:0 12px 8px;font-size:11px}.card small{height:30px;overflow:hidden}nav{padding:20px 40px;border-bottom:1px solid #27272a;display:flex;justify-content:space-between}h1{text-align:center;padding:30px 20px 0}.cta{background:#8b5cf6;color:#fff;padding:10px 24px;border-radius:12px;text-decoration:none}</style></head><body><nav><strong>OpenShorts</strong><a class="cta" href="/">Create Your Video</a></nav><h1>AI-Generated UGC Videos</h1><p style="text-align:center;color:#71717a">` + fmt.Sprintf("%d videos generated · Low Cost & Premium modes", len(videos)) + `</p><main class="grid">`)
	body.WriteString(`</main><div style="text-align:center;padding:40px"><a class="cta" href="/">Create Your Own UGC Video</a></div><script type="application/ld+json">` + safeJSON(ldJSON) + `</script></body></html>`)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(body.String()))
}

func (s *Server) videoPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/video/"), "/")
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Video not found"})
		return
	}
	videos, err := s.galleryVideos(r.Context(), 200)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	var selected map[string]any
	for _, video := range videos {
		if firstString(video, "video_id") == id {
			selected = video
			break
		}
	}
	if selected == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Video not found"})
		return
	}
	title := firstString(selected, "title")
	hashtags := strings.Join(metadataStrings(selected["hashtags"]), " ")
	cost := metadataNestedFloat(selected, "cost_estimate", "total")
	language := firstString(selected, "language")
	if language == "" {
		language = "en"
	}
	ldJSON := map[string]any{"@context": "https://schema.org", "@type": "VideoObject", "name": title, "description": firstString(selected, "caption"), "thumbnailUrl": firstString(selected, "actor_url"), "contentUrl": firstString(selected, "video_url"), "uploadDate": firstString(selected, "created_at"), "duration": fmt.Sprintf("PT%dS", int(metadataFloat(selected["duration"]))), "width": 1080, "height": 1920, "inLanguage": language}
	body := `<!doctype html><html lang="` + html.EscapeString(language) + `"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>` + html.EscapeString(title) + ` - AI UGC Video | OpenShorts</title><meta name="description" content="` + html.EscapeString(firstString(selected, "caption")+" "+hashtags) + `"><meta property="og:type" content="video.other"><meta property="og:title" content="` + html.EscapeString(title) + `"><meta property="og:description" content="` + html.EscapeString(firstString(selected, "caption")) + `"><meta property="og:video" content="` + html.EscapeString(firstString(selected, "video_url")) + `"><meta property="og:video:type" content="video/mp4"><meta property="og:video:width" content="1080"><meta property="og:video:height" content="1920"><meta property="og:image" content="` + html.EscapeString(firstString(selected, "actor_url")) + `"><meta name="twitter:card" content="player"><meta name="twitter:title" content="` + html.EscapeString(title) + `"><meta name="twitter:image" content="` + html.EscapeString(firstString(selected, "actor_url")) + `"><script type="application/ld+json">` + safeJSON(ldJSON) + `</script><style>*{box-sizing:border-box}body{background:#0a0a0c;color:#e4e4e7;font-family:system-ui,sans-serif;margin:0}nav{padding:20px 40px;border-bottom:1px solid #27272a}nav a{color:#a1a1aa}.container{max-width:1000px;margin:auto;padding:40px 20px;display:grid;grid-template-columns:1fr 1fr;gap:40px}@media(max-width:768px){.container{grid-template-columns:1fr}}video{width:100%;border-radius:16px;background:#000}.section{margin:20px 0}.section h2{font-size:13px;color:#71717a;text-transform:uppercase}.section p{font-size:14px;line-height:1.6}.cta{display:inline-block;background:#8b5cf6;color:#fff;padding:10px 24px;border-radius:12px;text-decoration:none}</style></head><body><nav><a href="/gallery">Gallery</a></nav><main class="container"><div><video src="` + html.EscapeString(firstString(selected, "video_url")) + `" poster="` + html.EscapeString(firstString(selected, "actor_url")) + `" controls autoplay playsinline style="aspect-ratio:9/16;object-fit:cover"></video></div><div><h1>` + html.EscapeString(title) + `</h1><p>` + html.EscapeString(fmt.Sprintf("%.0fs · %s · $%.2f · %s", metadataFloat(selected["duration"]), map[bool]string{true: "Low Cost", false: "Premium"}[firstString(selected, "video_mode") == "lowcost"], cost, firstString(selected, "product_name"))) + `</p><div class="section"><h2>Caption</h2><p>` + html.EscapeString(firstString(selected, "caption")) + `</p><p>` + html.EscapeString(hashtags) + `</p></div><div class="section"><h2>Script</h2><p>` + html.EscapeString(firstString(selected, "full_narration")) + `</p></div><div class="section"><h2>Actor</h2><p>` + html.EscapeString(firstString(selected, "actor_description")) + `</p></div>`
	if productURL := firstString(selected, "product_url"); productURL != "" {
		body += `<div class="section"><h2>Product</h2><p><a href="` + html.EscapeString(productURL) + `" target="_blank">` + html.EscapeString(firstString(selected, "product_name")) + `</a></p></div>`
	}
	body += `<a href="/gallery">← Back to Gallery</a><br><a class="cta" href="/">Create Your Own</a></div></main></body></html>`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(body))
}
