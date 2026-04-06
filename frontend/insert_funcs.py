import codecs

path = 'src/App.jsx'
with codecs.open(path, 'r', 'utf-8') as f:
    content = f.read()

snippet = '''
function formatDomainListForTextarea(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("\\n");
}

function parseDomainListFromTextarea(value = "") {
  return [...new Set(
    String(value ?? "")
      .split(/\\r?\\n|,|;/)
      .map((item) => String(item ?? "").trim().toLowerCase())
      .filter(Boolean)
  )];
}

function buildSourceProfilesDraft(profiles = {}) {
  return {
    trusted_domains: formatDomainListForTextarea(profiles?.trusted_domains),
    blocked_domains: formatDomainListForTextarea(profiles?.blocked_domains),
    video_platform_domains: formatDomainListForTextarea(profiles?.video_platform_domains),
    social_domains: formatDomainListForTextarea(profiles?.social_domains),
    downloadable_domains: formatDomainListForTextarea(profiles?.downloadable_domains),
    screenshot_friendly_domains: formatDomainListForTextarea(profiles?.screenshot_friendly_domains),
    domain_profiles_json: JSON.stringify(profiles?.domain_profiles ?? {}, null, 2)
  };
}
'''

content = content.replace('const normalizeResearchSources = (value) => {', snippet + 'const normalizeResearchSources = (value) => {')

with codecs.open(path, 'w', 'utf-8') as f:
    f.write(content)

