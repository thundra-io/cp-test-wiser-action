import * as core from '@actions/core'
import * as logger from './logger'
import * as github from '@actions/github'
import {Octokit} from '@octokit/action'
import fetch from 'node-fetch'

async function run(): Promise<void> {
  async function sendToTestWiser(param: any) {
    try {
      // 👇️ const response: Response
      const response = await fetch(
        'https://4kar344req4lry6ptdp53tqly40sbxmw.lambda-url.us-west-2.on.aws/',
        {
          method: 'POST',
          body: JSON.stringify(param)
        }
      )

      if (!response.ok) {
        throw new Error(`Error! status: ${response.status}`)
      }

      // 👇️ const result: GetUsersResponse
      const result = await response.text()

      return result
    } catch (error) {
      if (error instanceof Error) {
        logger.error(` sendToTestWiser error message : ${error.message}`)
        return error.message
      } else {
        logger.error(`unexpected error: ${error}`)
        return 'An unexpected error occurred'
      }
    }
  }

  function simplifyGitPatch(patch: any): unknown {
    const lines = patch.split(/\r\n|\r|\n/)
    let currentLine = 0

    const lineList = []
    for (const line of lines) {
      if (line.includes('@@')) {
        const numberPart = line.match('@@(.*?)@@')[1]
        currentLine = numberPart.match('\\+(.*?),')[1]
        continue
      }

      if (!line.startsWith('-') && !line.includes('@@')) {
        currentLine++
        const sourceFileLine = {
          modified: line.startsWith('+'),
          lineContent: line,
          lineNumber: currentLine - 1
        }
        lineList.push(sourceFileLine)
      }
    }
    return lineList
  }

  function createCommentSummary(result: any): string {
    const jsonData = JSON.parse(result)
    let commentSummary = `## <img style="max-width: 100%;margin-bottom: -10px;" width="40" height="40" src="https://media.licdn.com/dms/image/C560BAQEvniJjrPUgow/company-logo_200_200/0/1668188077513?e=1698278400&v=beta&t=qSx9iFeU2QI2RfDWdzFThflx5OnsiMLIf2fzzDSBlzs">  Catchpoint tests that should be run according to the source code modifications`
    for (const catchpointTest of jsonData) {
      commentSummary += `\n`
      commentSummary += `### Catchpoint Test Id: ${catchpointTest.testId}`
      commentSummary += `\n`
      commentSummary += '```mermaid'
      commentSummary += `\n`
      commentSummary += `${catchpointTest.mermaidFlowChart}`
      commentSummary += '```'
      commentSummary += `\n`
      commentSummary += `${catchpointTest.traceGraphExplanation}`
    }
    return commentSummary
  }

  try {
    process.env['GITHUB_TOKEN'] = `${core.getInput('github-token')}`

    const eventName = github.context.eventName

    const octokit = new Octokit()
    let base: string | undefined
    let head: string | undefined

    if (eventName === 'pull_request') {
      base = github.context.payload.pull_request?.base?.sha
      head = github.context.payload.pull_request?.head?.sha
    } else {
      return
    }

    if (!base || !head) {
      logger.error('Missing data from Github.')

      base = ''
      head = ''
    }

    const response = await octokit.rest.repos.compareCommits({
      base,
      head,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo
    })

    if (response.data.status !== 'ahead') {
      logger.error(`head commit must be ahead of base commit.`)
      return
    }
    const responseFiles = JSON.stringify(response.data?.files)
    const files = JSON.parse(responseFiles)
    for (const file of files) {
      file.patch = simplifyGitPatch(file.patch)
    }
    const result = await sendToTestWiser(files)
    const issueNumber = github.context.payload.pull_request?.number
    if (!issueNumber) {
      return
    }
    await octokit.rest.issues.createComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: issueNumber,
      body: createCommentSummary(result)
    })
  } catch (error) {
    if (error instanceof Error) logger.error(`general error: ${error.message}`)
  }
}

run()
