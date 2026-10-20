# Rikaz admin dashboard: guide

The dashboard is at **https://rikazfoods.ly/admin/**. Use it to add and edit brands and products, choose
the products on the home page, and publish your changes to the website. All you need is a GitHub account
that has access to the website's repository.

---

## For the developer: one-time setup

1. **Turn on publishing from GitHub Actions.** In the repository, open *Settings → Pages → Build and deployment*
   and set **Source** to **GitHub Actions**. The custom domain (`rikazfoods.ly`) stays as it is.
2. **Give the owner access** if their GitHub account isn't the one that owns the repository: open
   *Settings → Collaborators → Add people* and add their GitHub username. They must accept the email invite.
3. Open https://rikazfoods.ly/admin/ yourself and sign in once to check that everything works.

## For the owner: signing in for the first time

You need an **access key** (GitHub calls it a "personal access token"). You only make it once. It lets the
dashboard save changes to the website for you.

**If your account owns the repository**, make a *fine-grained* key. It can only touch the website:

1. Sign in at github.com and open **https://github.com/settings/personal-access-tokens/new**.
2. **Token name:** `Rikaz admin`. **Expiration:** pick a date, for example one year from now.
3. **Repository access:** choose *Only select repositories* and pick **sheedosa/rikaz-website**.
4. **Permissions → Repository permissions:**
   - **Contents:** *Read and write*
   - **Actions:** *Read-only* (lets the dashboard show when the website is live)
5. Click **Generate token** and copy the key. It starts with `github_pat_`.

**If you were added as a collaborator**, the website's repository won't appear in step 3. Use a *classic* key instead:

1. Open **https://github.com/settings/tokens/new?scopes=public_repo&description=Rikaz%20admin**.
2. Pick an expiration, leave only **public_repo** ticked, click **Generate token** and copy the key. It starts with `ghp_`.

Then open https://rikazfoods.ly/admin/, paste the key and click **Sign in**. Leave *Keep me signed in on this
device* ticked on your own computer or phone. Untick it on a shared computer.

> Keep the key private. Anyone who has it can change the website. If it leaks, delete it at
> github.com → Settings → Developer settings, then make a new one.

## Everyday use

| To… | Go to |
|---|---|
| Add a product | **Products → Add product**, or **Add** on a brand's page |
| Change a product's details or photo | **Products** → click the product |
| Add or edit a brand | **Brands** |
| Change the order of brands | **Brands → Change order** |
| Change the order of a brand's products | open the brand → arrows next to each product |
| Choose the 8 products at the top of the home page | **Home page** |
| See what changed, or undo a change | **History** |

**Saving and publishing**
- **Save** keeps your change as a **draft** in this browser. The website doesn't change yet.
- When you're ready, click **Publish** (top right). It lists your changes. Click **Publish to website**.
- The website updates in **about 3–5 minutes**. The status at the top turns to **Site is live**.
- You can save many changes and publish them all at once.
- Drafts stay saved if you close the browser, but only on that device.

**Undo:** in **History**, click **Undo** next to any published change. The affected brands and products go back to
how they were before that change, as a draft. Check it, then **Publish**.

## Tips

- **Photos:** use a clear pack shot on a white or transparent background (JPG or PNG). The dashboard resizes
  and optimises it automatically. iPhone *HEIC* photos aren't supported: share the photo as JPG first.
- **Sizes and units:** write them in English, for example `250 ml`, `1 kg`, `24 × 150 g` or `12 months`. The
  Arabic site translates the units automatically.
- **Empty fields:** if size, case quantity or shelf life is empty, the website shows "On request".
- **Coming soon:** set a product's status to *Coming soon* to label it that way on the site.
- **Web addresses** of products and brands never change once created, so shared links keep working.
- A product shown on the home page can't be deleted. Replace it under **Home page** first.
- A brand that still has products can't be deleted. Delete or move its products first.

## If something goes wrong

- **"GitHub did not accept the access key"**: the key expired or was deleted. Make a new one as above.
- **"Publish failed"**: your changes are saved on GitHub, but the website wasn't rebuilt, so it still shows
  the previous version. Click the status to see the details and send the link to your developer.
- **"The catalogue changed on GitHub while you were publishing"**: someone else published at the same time.
  The dashboard combines both sets of changes automatically. If they clash, it shows what to fix.
