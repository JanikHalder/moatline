import { describe, it, expect, vi, afterEach } from "vitest";
import {
  triggerDeploy,
  fetchApplicationDomains,
  parseApplications,
  matchApplication,
  listApplications,
  githubRepoOfUrl,
  parseServices,
  serviceOfContainer,
  dashboardUrl,
} from "./dokploy";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("triggerDeploy", () => {
  it("POSTs to /api/application.deploy with the x-api-key header", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 }))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await triggerDeploy({
      baseUrl: "https://panel.example.com/",
      token: "tok",
      applicationId: "app1",
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://panel.example.com/api/application.deploy");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toMatchObject({
      applicationId: "app1",
    });
  });

  it("returns ok:false with status 0 on a network error", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("boom"))
    ) as unknown as typeof fetch;
    const res = await triggerDeploy({
      baseUrl: "https://x",
      token: "t",
      applicationId: "a",
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
  });
});

describe("fetchApplicationDomains", () => {
  it("builds URLs from the domains Dokploy reports", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { host: "app.example.com", https: true, path: "/" },
            { host: "old.example.com", https: false, path: "/checker" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const urls = await fetchApplicationDomains({
      baseUrl: "https://panel.example.com/",
      token: "tok",
      applicationId: "app1",
    });

    expect(urls).toEqual([
      "https://app.example.com",
      "http://old.example.com/checker",
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://panel.example.com/api/domain.byApplicationId?applicationId=app1"
    );
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("tok");
  });

  it("returns nothing rather than failing when Dokploy does not answer", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("boom"))
    ) as unknown as typeof fetch;
    expect(
      await fetchApplicationDomains({
        baseUrl: "https://x",
        token: "t",
        applicationId: "a",
      })
    ).toEqual([]);
  });
});

describe("parseApplications / matchApplication", () => {
  const body = [
    {
      name: "Clients",
      // Never kept: database credentials ride along in project.all.
      postgres: [{ databasePassword: "secret" }],
      applications: [
        {
          applicationId: "a1",
          name: "Shop",
          appName: "shop-abc123",
          owner: "Acme",
          repository: "Shop",
          branch: "main",
          autoDeploy: true,
        },
      ],
      environments: [
        {
          name: "staging",
          applications: [
            {
              applicationId: "a2",
              name: "Shop staging",
              appName: "shop-staging-x",
              customGitUrl: "git@github.com:acme/shop.git",
              customGitBranch: "develop",
            },
          ],
        },
      ],
    },
  ];

  it("reads applications of old and new Dokploy layouts, nothing else", () => {
    const apps = parseApplications(body);
    expect(apps).toEqual([
      {
        applicationId: "a1",
        kind: "application",
        name: "Shop",
        appName: "shop-abc123",
        project: "Clients",
        environment: null,
        githubRepo: "acme/shop",
        branch: "main",
        autoDeploy: true,
        projectId: null,
        environmentId: null,
        serverId: null,
      },
      {
        applicationId: "a2",
        kind: "application",
        name: "Shop staging",
        appName: "shop-staging-x",
        project: "Clients",
        environment: "staging",
        githubRepo: "acme/shop",
        branch: "develop",
        autoDeploy: false,
        projectId: null,
        environmentId: null,
        serverId: null,
      },
    ]);
    expect(JSON.stringify(apps)).not.toContain("secret");
  });

  it("matches by repository, preferring the same branch", () => {
    const apps = parseApplications(body);
    expect(
      matchApplication(
        { githubUrl: "https://github.com/acme/shop", defaultBranch: "main" },
        apps
      )?.applicationId
    ).toBe("a1");
    // Two apps, neither on the branch: ambiguous.
    expect(
      matchApplication(
        { githubUrl: "https://github.com/acme/shop", defaultBranch: "prod" },
        apps
      )
    ).toBeNull();
    expect(
      matchApplication(
        { githubUrl: "https://github.com/acme/other", defaultBranch: "main" },
        apps
      )
    ).toBeNull();
  });
});

describe("listApplications", () => {
  it("asks per project when project.all lists no services", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn((url: string) => {
      calls.push(url);
      const body = url.endsWith("/api/project.all")
        ? [{ projectId: "p1", name: "Clients", environments: [] }]
        : url.includes("environment.byProjectId")
          ? [
              {
                environmentId: "e1",
                name: "production",
                projectId: "p1",
                applications: [
                  { applicationId: "a9", appName: "web-x1", name: "Web" },
                ],
              },
            ]
          : {};
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200 })
      );
    }) as unknown as typeof fetch;
    const res = await listApplications({ baseUrl: "https://d", token: "t" });
    expect(res).toMatchObject({
      ok: true,
      apps: [
        {
          applicationId: "a9",
          project: "Clients",
          environment: "production",
        },
      ],
    });
    expect(
      calls.some((c) => c.includes("environment.byProjectId?projectId=p1"))
    ).toBe(true);
  });

  it("says why the list is empty", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify([{ projectId: "p1", name: "X" }]), {
          status: 200,
        })
      )
    ) as unknown as typeof fetch;
    const res = await listApplications({ baseUrl: "https://d", token: "t" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("1 project(s) but no applications");
  });
});

describe("compose stacks and repository URLs", () => {
  it("lists compose stacks next to applications", () => {
    const apps = parseApplications([
      {
        name: "Clients",
        environments: [
          {
            name: "production",
            environmentId: "e1",
            compose: [
              {
                composeId: "c1",
                appName: "shop-stack-9x",
                name: "Shop stack",
                owner: "acme",
                repository: "shop",
                branch: "main",
              },
            ],
          },
        ],
      },
    ]);
    expect(apps).toMatchObject([
      { applicationId: "c1", kind: "compose", githubRepo: "acme/shop" },
    ]);
  });

  it("reads owner/repo from URLs with a path after them", () => {
    expect(githubRepoOfUrl("https://github.com/Acme/Shop/tree/main")).toBe(
      "acme/shop"
    );
    expect(githubRepoOfUrl("https://github.com/acme/shop.git")).toBe(
      "acme/shop"
    );
  });

  it("asks for the source of services listed without it", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      const body = url.endsWith("/api/project.all")
        ? [
            {
              name: "Clients",
              applications: [{ applicationId: "a1", appName: "web-1" }],
            },
          ]
        : url.includes("application.one")
          ? {
              applicationId: "a1",
              appName: "web-1",
              owner: "acme",
              repository: "web",
              branch: "main",
              autoDeploy: true,
            }
          : {};
      return Promise.resolve(new Response(JSON.stringify(body)));
    }) as unknown as typeof fetch;
    const res = await listApplications({ baseUrl: "https://d", token: "t" });
    expect(res).toMatchObject({
      ok: true,
      apps: [{ githubRepo: "acme/web", autoDeploy: true, kind: "application" }],
    });
  });
});

describe("listApplications completeness", () => {
  it("asks for projects that project.all returned without services", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      const body = url.endsWith("/api/project.all")
        ? [
            {
              projectId: "pA",
              name: "ams-shop",
              applications: [
                {
                  applicationId: "a1",
                  appName: "ams-1",
                  owner: "acme",
                  repository: "ams",
                },
              ],
            },
            { projectId: "pZ", name: "zoo", environments: [] },
          ]
        : url.includes("project.search")
          ? [
              { projectId: "pA", name: "ams-shop" },
              { projectId: "pZ", name: "zoo" },
              { projectId: "pM", name: "museum" },
            ]
          : url.includes("environment.byProjectId?projectId=pZ")
            ? [
                {
                  environmentId: "e1",
                  name: "production",
                  applications: [
                    {
                      applicationId: "z1",
                      appName: "zoo-1",
                      owner: "acme",
                      repository: "zoo",
                    },
                  ],
                },
              ]
            : url.includes("environment.byProjectId?projectId=pM")
              ? [
                  {
                    environmentId: "e2",
                    name: "production",
                    compose: [
                      {
                        composeId: "m1",
                        appName: "museum-1",
                        owner: "acme",
                        repository: "museum",
                      },
                    ],
                  },
                ]
              : [];
      return Promise.resolve(new Response(JSON.stringify(body)));
    }) as unknown as typeof fetch;
    const res = await listApplications({ baseUrl: "https://d", token: "t" });
    expect(res.ok && res.projects).toBe(3);
    expect(res.ok && res.apps.map((a) => a.applicationId)).toEqual([
      "a1",
      "m1",
      "z1",
    ]);
  });
});

describe("parseServices", () => {
  const body = [
    {
      projectId: "p1",
      name: "Kunde",
      environments: [
        {
          environmentId: "e1",
          name: "production",
          applications: [
            { applicationId: "a1", appName: "shop-x1", name: "Shop" },
          ],
          mongo: [
            {
              mongoId: "m1",
              appName: "mongo-db-y2",
              name: "Mongo",
              backups: [
                { backupId: "b1", mongoId: "m1", appName: "mongo-db-y2" },
              ],
            },
          ],
          redis: [{ redisId: "r1", appName: "redis-z3", name: "Cache" }],
        },
      ],
    },
  ];

  it("finds databases next to applications", () => {
    const all = parseServices(body);
    expect(all.map((s) => [s.kind, s.applicationId])).toEqual([
      ["application", "a1"],
      ["mongo", "m1"],
      ["redis", "r1"],
    ]);
    expect(all[1]).toMatchObject({
      project: "Kunde",
      environment: "production",
    });
  });

  it("keeps databases out of the application list", () => {
    expect(parseApplications(body).map((a) => a.applicationId)).toEqual(["a1"]);
  });
});

describe("serviceOfContainer", () => {
  const services = [
    { appName: "shop-x1" },
    { appName: "shop-x1-api" },
    { appName: "mongo-db-y2" },
  ];
  it("matches the Swarm service exactly", () => {
    expect(serviceOfContainer({ app: "mongo-db-y2" }, services)?.appName).toBe(
      "mongo-db-y2"
    );
  });
  it("prefers the longest prefix for compose services", () => {
    expect(
      serviceOfContainer({ app: "shop-x1-api-web" }, services)?.appName
    ).toBe("shop-x1-api");
    expect(serviceOfContainer({ app: "shop-x1-web" }, services)?.appName).toBe(
      "shop-x1"
    );
  });
  it("ignores containers Dokploy does not run", () => {
    expect(serviceOfContainer({ app: "traefik" }, services)).toBeNull();
  });
});

describe("dashboardUrl", () => {
  it("links into Dokploy, with and without environments", () => {
    expect(
      dashboardUrl("https://panel.example.com/", {
        kind: "application",
        applicationId: "a1",
        projectId: "p1",
        environmentId: "e1",
      })
    ).toBe(
      "https://panel.example.com/dashboard/project/p1/environment/e1/services/application/a1"
    );
    expect(
      dashboardUrl("https://panel.example.com", {
        kind: "compose",
        applicationId: "c1",
        projectId: "p1",
      })
    ).toBe(
      "https://panel.example.com/dashboard/project/p1/services/compose/c1"
    );
    expect(
      dashboardUrl("https://panel.example.com", {
        kind: "application",
        applicationId: "a1",
      })
    ).toBeNull();
  });

  it("remembers the environment while reading project.all", () => {
    const [app] = parseApplications([
      {
        projectId: "p1",
        name: "Kunde",
        environments: [
          {
            environmentId: "e1",
            name: "production",
            applications: [
              { applicationId: "a1", appName: "shop-x1", name: "Shop" },
            ],
          },
        ],
      },
    ]);
    expect(app).toMatchObject({ projectId: "p1", environmentId: "e1" });
  });
});
